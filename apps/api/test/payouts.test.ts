/** Naira withdrawals (D-067): own-name accounts only, 24 h wait, switch off by default, money held then settled once. */
import { createHmac } from "node:crypto";
import { Secrets, freshDatabase, insertLedger, ledgerSum, setFlag, testKeyB64, type Db } from "@constant/db";
import { FakeCableVending, FakeFunding, FakeIdentity, FakeOfframp } from "@constant/partners";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/index.js";
import { verifyIdentity } from "./kyc-helper.js";

let db: Db;
let drop: () => Promise<void>;
let app: FastifyInstance;
// The database stamps the payout account with the real time, so this test's clock starts from it too.
let clock = new Date();
const funding = new FakeFunding("whsec");
const offramp = new FakeOfframp("pc-secret");
const as = { authorization: "Bearer fake:did:privy:wd", "content-type": "application/json" };
const call = (method: "GET" | "POST" | "PUT", url: string, body?: unknown) => app.inject({ method, url, headers: as, ...(body !== undefined ? { payload: JSON.stringify(body) } : {}) });

beforeAll(async () => {
  ({ db, drop } = await freshDatabase());
  app = await buildApp({
    db, identity: new FakeIdentity(), vending: new FakeCableVending(), funding, payouts: funding, offramp,
    secrets: new Secrets({ encryption: [{ id: "k1", key: Buffer.from(testKeyB64(), "base64") }], hmac: Buffer.from(testKeyB64(), "base64") }),
    webOrigins: [], vtpassWebhookToken: "x".repeat(20), fundingEmailDomain: "x", now: () => clock, logger: false,
  });
  funding.accounts.set("058:0987654321", "EZE CAROL NGOZI");
  funding.accounts.set("044:1111111111", "BELLO TUNDE");
});
afterAll(async () => {
  await app?.close();
  await drop?.();
});

describe("withdrawals", () => {
  let userId = "";
  it("needs a verified identity first, then accepts only an account in that name", async () => {
    const before = await call("PUT", "/v1/payout-account", { bankCode: "058", accountNumber: "0987654321" });
    expect([before.statusCode, before.json().error]).toEqual([403, "verify_identity"]);
    await verifyIdentity(app, funding, as, { firstName: "Carol", lastName: "Eze" });
    userId = (await call("GET", "/v1/me")).json().user.id;
    // The name to match is the one the BVN check confirmed: no account number needed first.
    expect((await call("PUT", "/v1/payout-account", { bankCode: "044", accountNumber: "1111111111" })).json().error).toBe("name_mismatch");
    expect((await call("PUT", "/v1/payout-account", { bankCode: "058", accountNumber: "0000000000" })).json().error).toBe("not_found");
    const ok = await call("PUT", "/v1/payout-account", { bankCode: "058", accountNumber: "0987654321" });
    expect(ok.json()).toMatchObject({ bankName: "Guaranty Trust Bank", last4: "4321", accountName: "EZE CAROL NGOZI" });
    await call("POST", "/v1/funding-account", {}); // for the transfers below
  });

  it("is off until the payouts switch is on; then waits 24 hours after the account was added", async () => {
    await insertLedger(db, { userId, kind: "fund", amountMinor: 5_000_000n, currency: "NGN", idempotencyKey: "wd:fund", actor: "test" });
    expect((await call("POST", "/v1/withdrawals", { amountMinor: "1000000" })).json().error).toBe("paused");
    await setFlag(db, "payouts_enabled", true, "test", "tests");
    expect((await call("POST", "/v1/withdrawals", { amountMinor: "1000000" })).json().error).toBe("unverified_payout");
    clock = new Date(clock.getTime() + 25 * 3_600_000);
  });

  it("holds the money at once; never more than the balance", async () => {
    expect((await call("POST", "/v1/withdrawals", { amountMinor: "6000000" })).json().error).toBe("insufficient");
    const r = await call("POST", "/v1/withdrawals", { amountMinor: "1000000" });
    expect(r.statusCode).toBe(202);
    expect(await ledgerSum(db, userId)).toBe(4_000_000n);
  });

  it("D-088: money added by card in the last 3 days can't be withdrawn yet; transfers can", async () => {
    // A card top-up of ₦30,000 credited just now (as settleTopup records it).
    await db.query(
      "INSERT INTO topups (user_id, provider, reference, credit_minor, fee_minor, total_minor, status, channel) VALUES ($1, 'fake', 'cu_top_cardhold', 3000000, 0, 3000000, 'credited', 'card')",
      [userId],
    );
    const r = await call("POST", "/v1/withdrawals", { amountMinor: "2000000" });
    expect(r.json()).toMatchObject({ error: "card_hold" });
    expect(r.json().message).toContain("₦10,000");
    // The app is told the same figure before the person tries.
    expect((await call("GET", "/v1/withdrawals/available")).json()).toMatchObject({ withdrawableMinor: "1000000", cardHeldMinor: "3000000" });
    // Three days later the hold is over: the whole free balance can go.
    await db.query("UPDATE topups SET created_at = now() - interval '4 days' WHERE reference = 'cu_top_cardhold'");
    // Past the hold, asking for more than the free balance is just "insufficient", never "card_hold".
    expect((await call("POST", "/v1/withdrawals", { amountMinor: "5000000" })).json().error).toBe("insufficient");
    expect((await call("GET", "/v1/withdrawals/available")).json()).toMatchObject({ withdrawableMinor: "4000000", cardHeldMinor: "0" });
  });

  it("a signed failure webhook gives the money back once, however often it's replayed", async () => {
    const w = (await call("GET", "/v1/withdrawals")).json()[0];
    const ref = (await db.query("SELECT reference FROM withdrawals WHERE id = $1", [w.id])).rows[0].reference;
    await db.query("UPDATE withdrawals SET status = 'sent' WHERE id = $1", [w.id]);
    const body = JSON.stringify({ event: "transfer.failed", data: { reference: ref } });
    const sig = createHmac("sha512", "whsec").update(body).digest("hex");
    for (let i = 0; i < 3; i++) {
      await app.inject({ method: "POST", url: "/webhooks/paystack", headers: { "content-type": "application/json", "x-paystack-signature": sig }, payload: body });
    }
    expect(await ledgerSum(db, userId)).toBe(5_000_000n);
    expect((await call("GET", "/v1/withdrawals")).json()[0].status).toBe("failed");
  });
});

describe("Paycrest webhook (D-068)", () => {
  it("a signed final status settles a funded off-ramp; a bad signature changes nothing", async () => {
    await db.query("INSERT INTO offramps (provider, provider_order, reference, token, amount_micro, status) VALUES ('paycrest', 'ord_x', 'ofr_x', '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', 100000000, 'funded')");
    const body = JSON.stringify({ event: "payment_order.settled", data: { id: "ord_x", reference: "ofr_x", status: "settled" } });
    const bad = await app.inject({ method: "POST", url: "/webhooks/paycrest", headers: { "content-type": "application/json", "x-paycrest-signature": "00" }, payload: body });
    expect(bad.statusCode).toBe(401);
    expect((await db.query("SELECT status FROM offramps WHERE reference = 'ofr_x'")).rows[0].status).toBe("funded");
    await app.inject({ method: "POST", url: "/webhooks/paycrest", headers: { "content-type": "application/json", "x-paycrest-signature": offramp.sign(body) }, payload: body });
    expect((await db.query("SELECT status FROM offramps WHERE reference = 'ofr_x'")).rows[0].status).toBe("settled");
  });
});
