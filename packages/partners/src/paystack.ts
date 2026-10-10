/**
 * Paystack dedicated virtual accounts (D-022): each user gets their own account number; transfers into it
 * arrive as a signed `charge.success` webhook with channel `dedicated_nuban`. The signature is
 * HMAC-SHA512 of the raw body with the secret key, in `x-paystack-signature`.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { fetchJson, type Fetch } from "./http.js";
import type { DedicatedAccount, Funding, FundingCredit } from "./types.js";

export interface PaystackConfig {
  secretKey: string;
  /** "wema-bank" or "titan-paystack" live; "test-bank" with a test key. */
  preferredBank: string;
  baseUrl?: string;
  fetch?: Fetch;
}

export class PaystackError extends Error {}

export class Paystack implements Funding {
  readonly name = "paystack";
  private readonly f: Fetch;
  private readonly base: string;

  constructor(private readonly c: PaystackConfig) {
    this.f = c.fetch ?? fetch;
    this.base = c.baseUrl ?? "https://api.paystack.co";
  }

  private async post(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const res = await fetchJson(this.f, `${this.base}${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.c.secretKey}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      timeoutMs: 30_000,
    });
    const b = res.body as { status?: boolean; message?: string; data?: Record<string, unknown> };
    if (!b?.status || !b.data) throw new PaystackError(b?.message ?? `paystack ${path} failed (${res.status})`);
    return b.data;
  }

  async createDedicatedAccount(c: { email: string; firstName: string; lastName: string; phone: string }): Promise<DedicatedAccount> {
    const customer = await this.post("/customer", { email: c.email, first_name: c.firstName, last_name: c.lastName, phone: c.phone });
    const customerCode = String(customer.customer_code ?? "");
    if (!customerCode) throw new PaystackError("paystack: no customer code");
    const acct = await this.post("/dedicated_account", { customer: customerCode, preferred_bank: this.c.preferredBank });
    const bank = acct.bank as { name?: string } | undefined;
    const accountNumber = String(acct.account_number ?? "");
    if (!accountNumber) throw new PaystackError("paystack: no account number yet");
    return { customerCode, accountNumber, bankName: bank?.name ?? "", accountName: String(acct.account_name ?? "") };
  }

  verifySignature(rawBody: string, headers: Record<string, string | string[] | undefined>): boolean {
    const sig = headers["x-paystack-signature"];
    if (typeof sig !== "string" || !/^[0-9a-f]{128}$/i.test(sig)) return false;
    const expected = createHmac("sha512", this.c.secretKey).update(rawBody).digest();
    return timingSafeEqual(expected, Buffer.from(sig, "hex"));
  }

  parseCredit(rawBody: string): FundingCredit | null {
    let b: { event?: string; data?: Record<string, unknown> };
    try {
      b = JSON.parse(rawBody);
    } catch {
      return null;
    }
    const d = b.data;
    if (b.event !== "charge.success" || !d || d.channel !== "dedicated_nuban" || d.status !== "success") return null;
    const customer = d.customer as { customer_code?: string } | undefined;
    // Paystack amounts are already in kobo, as integers.
    const amount = typeof d.amount === "number" && Number.isSafeInteger(d.amount) ? BigInt(d.amount) : typeof d.amount === "string" && /^\d+$/.test(d.amount) ? BigInt(d.amount) : null;
    if (!customer?.customer_code || amount === null || d.id == null) return null;
    return {
      eventId: String(d.id),
      customerCode: customer.customer_code,
      amountMinor: amount,
      currency: String(d.currency ?? "NGN"),
      reference: String(d.reference ?? ""),
    };
  }
}

/** For tests and local dev: signs with a known secret, hands out predictable account numbers. */
export class FakeFunding implements Funding {
  readonly name = "fake";
  private n = 0;
  constructor(readonly secret = "fake-secret") {}

  async createDedicatedAccount(c: { email: string; firstName: string; lastName: string }): Promise<DedicatedAccount> {
    this.n += 1;
    return { customerCode: `CUS_fake${this.n}_${c.email}`, accountNumber: String(9_900_000_000 + this.n), bankName: "Test Bank", accountName: `CONSTANT/${c.firstName} ${c.lastName}`.toUpperCase() };
  }

  sign(rawBody: string): string {
    return createHmac("sha512", this.secret).update(rawBody).digest("hex");
  }

  verifySignature(rawBody: string, headers: Record<string, string | string[] | undefined>): boolean {
    return headers["x-paystack-signature"] === this.sign(rawBody);
  }

  parseCredit(rawBody: string): FundingCredit | null {
    return new Paystack({ secretKey: this.secret, preferredBank: "test-bank" }).parseCredit(rawBody);
  }
}
