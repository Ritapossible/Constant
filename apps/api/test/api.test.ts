/**
 * API: auth, the cable bill lifecycle, funding webhooks (INV-7), the VTpass hint webhook (rule 6), privacy (rule 9).
 */
import { createHmac } from "node:crypto";
import { Secrets, freshDatabase, ledgerSum, testKeyB64, type Db } from "@constant/db";
import { FakeCableVending, FakeFunding, FakeIdentity } from "@constant/partners";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/index.js";

let db: Db;
let drop: () => Promise<void>;
let app: FastifyInstance;
const vending = new FakeCableVending();
const funding = new FakeFunding("whsec");
const NOW = new Date("2026-11-10T09:00:00Z");
const WEBHOOK_TOKEN = "vt-0123456789abcdef";

beforeAll(async () => {
  ({ db, drop } = await freshDatabase());
  vending.decoders.set("7012345678", { customerName: "ADA OBI", plan: "DStv Compact", renewalAmountMinor: 1_995_000n, dueAt: new Date("2026-11-14T23:00:00Z") });
  vending.decoders.set("1234567890", { customerName: "NO DATE", plan: "GOtv Max", renewalAmountMinor: 850_000n, dueAt: null });
  app = await buildApp({
    db,
    identity: new FakeIdentity(),
    vending,
    funding,
    secrets: new Secrets({ encryption: [{ id: "k1", key: Buffer.from(testKeyB64(), "base64") }], hmac: Buffer.from(testKeyB64(), "base64") }),
    webOrigins: ["https://constant-units.vercel.app"],
    vtpassWebhookToken: WEBHOOK_TOKEN,
    fundingEmailDomain: "users.example",
    now: () => NOW,
    logger: false,
  });
});
afterAll(async () => {
  await app?.close();
  await drop?.();
});

const as = (did: string) => ({ authorization: `Bearer fake:${did}`, "content-type": "application/json" });
const call = (method: "GET" | "POST" | "PATCH" | "DELETE", url: string, did: string | null, body?: unknown) =>
  app.inject({ method, url, headers: did ? as(did) : { "content-type": "application/json" }, ...(body !== undefined ? { payload: JSON.stringify(body) } : {}) });

describe("auth", () => {
  it("rejects missing and bad tokens", async () => {
    expect((await call("GET", "/v1/me", null)).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/v1/me", headers: { authorization: "Bearer nope" } })).statusCode).toBe(401);
  });

  it("creates the user on first sight with contact details from the identity provider", async () => {
    const r = await call("GET", "/v1/me", "did:privy:alice");
    expect(r.statusCode).toBe(200);
    expect(r.json().user.email).toBe("alice@example.com");
    expect(r.json().balance).toEqual({ currency: "NGN", ledgerMinor: "0", availableMinor: "0" });
    expect(r.json().payments).toBe("paused");
  });

  it("allows only the web origin for CORS", async () => {
    const ok = await app.inject({ method: "OPTIONS", url: "/v1/me", headers: { origin: "https://constant-units.vercel.app", "access-control-request-method": "GET" } });
    expect(ok.headers["access-control-allow-origin"]).toBe("https://constant-units.vercel.app");
    const no = await app.inject({ method: "OPTIONS", url: "/v1/me", headers: { origin: "https://evil.example", "access-control-request-method": "GET" } });
    expect(no.headers["access-control-allow-origin"]).toBeUndefined();
  });
});

describe("a cable bill", () => {
  let lineId = "";

  it("looks a decoder up", async () => {
    const r = await call("POST", "/v1/cable/lookup", "did:privy:alice", { provider: "dstv", smartcard: "70 1234 5678" });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ customerName: "ADA OBI", currentPlan: "DStv Compact", renewalAmountMinor: "1995000", dueAt: "2026-11-14T23:00:00.000Z" });
  });

  it("rejects a bad number and an unknown decoder", async () => {
    expect((await call("POST", "/v1/cable/lookup", "did:privy:alice", { provider: "dstv", smartcard: "123" })).json().error).toBe("invalid_smartcard");
    expect((await call("POST", "/v1/cable/lookup", "did:privy:alice", { provider: "dstv", smartcard: "7000000000" })).json().error).toBe("not_found");
    expect((await call("POST", "/v1/cable/lookup", "did:privy:alice", { provider: "showmax", smartcard: "7012345678" })).statusCode).toBe(400);
  });

  it("adds the bill with the provider's name and date, scheduled for 07:00 the day before the end", async () => {
    const r = await call("POST", "/v1/lines", "did:privy:alice", { provider: "dstv", smartcard: "7012345678", nickname: "Living room", customerName: "SOMEONE ELSE" });
    expect(r.statusCode).toBe(201);
    const l = r.json();
    lineId = l.id;
    expect(l).toMatchObject({ customerName: "ADA OBI", capMinor: "1995000", last4: "5678", nextRunAt: "2026-11-14T06:00:00.000Z", status: "active" });
    expect(JSON.stringify(l)).not.toContain("7012345678");
    const row = (await db.query("SELECT ref_ciphertext FROM lines WHERE id = $1", [lineId])).rows[0];
    expect(row.ref_ciphertext).not.toContain("7012345678");
  });

  it("refuses the same decoder twice", async () => {
    expect((await call("POST", "/v1/lines", "did:privy:alice", { provider: "dstv", smartcard: "7012345678" })).statusCode).toBe(409);
  });

  it("asks for the end date when the provider doesn't give one", async () => {
    expect((await call("POST", "/v1/lines", "did:privy:alice", { provider: "gotv", smartcard: "1234567890" })).json().error).toBe("due_date_needed");
    const r = await call("POST", "/v1/lines", "did:privy:alice", { provider: "gotv", smartcard: "1234567890", dueDate: "2026-12-01" });
    expect(r.statusCode).toBe(201);
    expect(r.json().nextRunAt).toBe("2026-11-30T06:00:00.000Z");
  });

  it("another user cannot see or change it", async () => {
    expect((await call("PATCH", `/v1/lines/${lineId}`, "did:privy:bob", { status: "paused" })).statusCode).toBe(404);
    expect((await call("GET", "/v1/me", "did:privy:bob")).json().lines).toEqual([]);
  });

  it("pauses, changes the limit, resumes; the payee cannot be changed", async () => {
    const r = await call("PATCH", `/v1/lines/${lineId}`, "did:privy:alice", { status: "paused", capMinor: "2500000", smartcard: "7099999999" });
    expect(r.json()).toMatchObject({ status: "paused", capMinor: "2500000", last4: "5678" });
    expect((await call("PATCH", `/v1/lines/${lineId}`, "did:privy:alice", { status: "active" })).json().status).toBe("active");
    expect((await call("PATCH", `/v1/lines/${lineId}`, "did:privy:alice", { capMinor: 25000 })).statusCode).toBe(400);
  });

  it("cancels", async () => {
    expect((await call("DELETE", `/v1/lines/${lineId}`, "did:privy:alice")).statusCode).toBe(204);
    expect((await call("GET", "/v1/me", "did:privy:alice")).json().lines.map((l: { id: string }) => l.id)).not.toContain(lineId);
  });
});

describe("profile", () => {
  it("sets and clears the display name", async () => {
    expect((await call("PATCH", "/v1/me", "did:privy:alice", { displayName: "Ada" })).json()).toEqual({ displayName: "Ada" });
    expect((await call("GET", "/v1/me", "did:privy:alice")).json().user.displayName).toBe("Ada");
    expect((await call("PATCH", "/v1/me", "did:privy:alice", { displayName: "x".repeat(41) })).statusCode).toBe(400);
  });
});

describe("funding", () => {
  it("gives the user their own account number, once", async () => {
    const a = await call("POST", "/v1/funding-account", "did:privy:carol", { firstName: "Carol", lastName: "Eze", phone: "08031234567" });
    expect(a.statusCode).toBe(200);
    const b = await call("POST", "/v1/funding-account", "did:privy:carol", {});
    expect(b.json()).toEqual(a.json());
    expect((await call("POST", "/v1/funding-account", "did:privy:dave", { firstName: "D", lastName: "E", phone: "123" })).json().error).toBe("invalid_phone");
  });

  it("INV-7: a signed transfer credits once, however often it is replayed; a bad signature credits nothing", async () => {
    const me = (await call("GET", "/v1/me", "did:privy:carol")).json();
    const acct = (await db.query("SELECT customer_code FROM funding_accounts WHERE user_id = $1", [me.user.id])).rows[0];
    const body = JSON.stringify({
      event: "charge.success",
      data: { id: 555, status: "success", channel: "dedicated_nuban", amount: 2_500_000, currency: "NGN", reference: "r", customer: { customer_code: acct.customer_code } },
    });
    const send = (sig: string) => app.inject({ method: "POST", url: "/webhooks/paystack", headers: { "content-type": "application/json", "x-paystack-signature": sig }, payload: body });

    expect((await send("0".repeat(128))).statusCode).toBe(401);
    expect(await ledgerSum(db, me.user.id)).toBe(0n);

    const sig = createHmac("sha512", "whsec").update(body).digest("hex");
    const results = await Promise.all(Array.from({ length: 5 }, () => send(sig)));
    expect(results.map((r) => r.json().result).sort()).toEqual(["credited", "duplicate", "duplicate", "duplicate", "duplicate"]);
    expect(await ledgerSum(db, me.user.id)).toBe(2_500_000n);
    const stored = await db.query("SELECT count(*)::int AS n FROM inbound_webhooks WHERE provider = 'paystack'");
    expect(stored.rows[0].n).toBe(6);
    const notices = await db.query("SELECT kind FROM notices WHERE user_id = $1", [me.user.id]);
    expect(notices.rows.map((r) => r.kind)).toEqual(["funded"]);
  });

  it("a transfer to an unknown account is recorded and paged, not credited", async () => {
    const body = JSON.stringify({ event: "charge.success", data: { id: 777, status: "success", channel: "dedicated_nuban", amount: 100, currency: "NGN", customer: { customer_code: "CUS_nobody" } } });
    const sig = createHmac("sha512", "whsec").update(body).digest("hex");
    const r = await app.inject({ method: "POST", url: "/webhooks/paystack", headers: { "content-type": "application/json", "x-paystack-signature": sig }, payload: body });
    expect(r.json().result).toBe("rejected");
    expect((await db.query("SELECT 1 FROM ops_alerts WHERE kind = 'funding_unmatched'")).rowCount).toBe(1);
  });
});

describe("VTpass webhook (unsigned hint)", () => {
  it("needs the secret path, answers as VTpass expects, and only nudges a requery", async () => {
    const payload = JSON.stringify({ type: "transaction-update", data: { requestId: "202611140700abc", code: "000", content: { transactions: { status: "delivered" } } } });
    expect((await app.inject({ method: "POST", url: "/webhooks/vtpass/wrong", headers: { "content-type": "application/json" }, payload })).statusCode).toBe(404);
    const r = await app.inject({ method: "POST", url: `/webhooks/vtpass/${WEBHOOK_TOKEN}`, headers: { "content-type": "application/json" }, payload });
    expect(r.json()).toEqual({ response: "success" });
    // Nothing settles from a webhook: no order rows changed, no ledger entries written.
    expect((await db.query("SELECT count(*)::int AS n FROM ledger_entries WHERE kind = 'vend'")).rows[0].n).toBe(0);
  });
});
