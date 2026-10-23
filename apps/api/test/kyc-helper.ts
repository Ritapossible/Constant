/** Test helper: takes a user through identity verification (D-086) the way production does it. */
import type { FakeFunding } from "@constant/partners";
import type { FastifyInstance } from "fastify";

let bvnSeq = 0;

export async function verifyIdentity(
  app: FastifyInstance,
  funding: FakeFunding,
  headers: Record<string, string>,
  person: { firstName: string; lastName: string; phone?: string },
): Promise<void> {
  bvnSeq += 1;
  const bvn = String(22_200_000_000 + bvnSeq);
  const r = await app.inject({
    method: "POST",
    url: "/v1/kyc/bvn",
    headers: { ...headers, "content-type": "application/json" },
    payload: JSON.stringify({ bvn, bankCode: "058", accountNumber: "0123456789", firstName: person.firstName, lastName: person.lastName, phone: person.phone ?? "08031234567" }),
  });
  if (r.statusCode !== 202) throw new Error(`kyc/bvn: ${r.statusCode} ${r.body}`);
  const code = funding.validations.at(-1)!.customerCode;
  const body = funding.identificationEvent(code, true);
  const w = await app.inject({ method: "POST", url: "/webhooks/paystack", headers: { "content-type": "application/json", "x-paystack-signature": funding.sign(body) }, payload: body });
  if (w.json().result !== "verified") throw new Error(`kyc webhook: ${w.body}`);
}
