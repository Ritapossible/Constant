/**
 * Identity tiers (D-086) and idempotency keys (D-087): verification through Paystack's signed webhook, one BVN per
 * account, the BVN never stored, limits on top-ups and withdrawals, transfers past the limits flagged, and requests
 * that move money answered once however often they're sent.
 */
import { Secrets, freshDatabase, testKeyB64, type Db } from "@constant/db";
import { FakeCableVending, FakeFunding, FakeIdentity } from "@constant/partners";
import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/index.js";

let db: Db;
let drop: () => Promise<void>;
let app: FastifyInstance;
const funding = new FakeFunding("whsec");
const NOW = new Date("2026-11-10T09:00:00Z");
const OPS = "o".repeat(40);

beforeAll(async () => {
  ({ db, drop } = await freshDatabase());
  app = await buildApp({
    db,
    identity: new FakeIdentity(),
    vending: new FakeCableVending(),
    funding,
    payouts: funding,
    checkout: { provider: funding, callbackUrl: "https://constant-units.vercel.app/app" },
    secrets: new Secrets({ encryption: [{ id: "k1", key: Buffer.from(testKeyB64(), "base64") }], hmac: Buffer.from(testKeyB64(), "base64") }),
    webOrigins: ["https://constant-units.vercel.app"],
    vtpassWebhookToken: "vt-0123456789abcdef",
    fundingEmailDomain: "users.example",
    now: () => NOW,
    logger: false,
    opsToken: OPS,
  });
});
afterAll(async () => {
  await app?.close();
  await drop?.();
});

const headers = (did: string, extra: Record<string, string> = {}) => ({ authorization: `Bearer fake:${did}`, "content-type": "application/json", ...extra });
const call = (method: "GET" | "POST", url: string, did: string, body?: unknown, extra: Record<string, string> = {}) =>
  app.inject({ method, url, headers: headers(did, extra), ...(body !== undefined ? { payload: JSON.stringify(body) } : {}) });
const hook = (body: string) => app.inject({ method: "POST", url: "/webhooks/paystack", headers: { "content-type": "application/json", "x-paystack-signature": funding.sign(body) }, payload: body });
const person = (bvn: string, extra: Record<string, unknown> = {}) => ({ bvn, bankCode: "058", accountNumber: "0123456789", firstName: "Chioma", lastName: "Obi", phone: "08031234567", ...extra });
const userId = async (did: string) => (await call("GET", "/v1/me", did)).json().user.id as string;

describe("identity tiers (D-086)", () => {
  it("starts everyone at Basic, with the limits that come with it", async () => {
    const k = (await call("GET", "/v1/kyc", "did:privy:k1")).json();
    expect(k.current).toMatchObject({ tier: 0, name: "Basic", dailyInMinor: "5000000", maxBalanceMinor: "30000000", dailyWithdrawMinor: "0", accountNumber: false });
    expect(k.tiers.map((t: { name: string }) => t.name)).toEqual(["Basic", "Verified", "Reviewed"]);
    expect(k.check).toBeNull();
  });

  it("checks the details before asking the bank", async () => {
    expect((await call("POST", "/v1/kyc/bvn", "did:privy:k0", person("123"))).json().error).toBe("invalid_bvn");
    expect((await call("POST", "/v1/kyc/bvn", "did:privy:k0", person("22211111111", { accountNumber: "12" }))).json().error).toBe("invalid_account");
    expect((await call("POST", "/v1/kyc/bvn", "did:privy:k0", person("22211111111", { bankCode: "" }))).json().error).toBe("invalid_bank");
    expect(funding.validations).toHaveLength(0);
  });

  it("a failed check says why in plain words, and can be tried again", async () => {
    expect((await call("POST", "/v1/kyc/bvn", "did:privy:k1", person("22211111111"))).statusCode).toBe(202);
    // A second tap while it's pending asks Paystack nothing more.
    expect((await call("POST", "/v1/kyc/bvn", "did:privy:k1", person("22211111111"))).json()).toEqual({ status: "pending" });
    expect(funding.validations).toHaveLength(1);
    const code = funding.validations[0]!.customerCode;
    expect((await hook(funding.identificationEvent(code, false))).json().result).toBe("failed");
    const k = (await call("GET", "/v1/kyc", "did:privy:k1")).json();
    expect(k.current.tier).toBe(0);
    expect(k.check).toMatchObject({ status: "failed", bvnLast4: "1111", accountLast4: "6789" });
    expect(k.check.reason).toContain("didn't match");
    const id = await userId("did:privy:k1");
    expect((await db.query("SELECT kind FROM notices WHERE user_id = $1 AND kind <> 'welcome'", [id])).rows.map((r) => r.kind)).toEqual(["kyc_failed"]);

    expect((await call("POST", "/v1/kyc/bvn", "did:privy:k1", person("22211111111"))).statusCode).toBe(202);
    expect((await hook(funding.identificationEvent(funding.validations.at(-1)!.customerCode, true))).json().result).toBe("verified");
    const v = (await call("GET", "/v1/kyc", "did:privy:k1")).json();
    expect(v.current).toMatchObject({ tier: 1, name: "Verified", accountNumber: true });
    expect(v.legalName).toBe("Chioma Obi");
    expect((await call("GET", "/v1/me", "did:privy:k1")).json().user.kycTier).toBe(1);
    // A replayed webhook changes nothing.
    expect((await hook(funding.identificationEvent(code, true))).json().result).toBe("ignored");
  });

  it("never stores the BVN, only its last 4 and a keyed hash", async () => {
    const rows = await db.query("SELECT * FROM kyc_checks");
    expect(JSON.stringify(rows.rows)).not.toContain("22211111111");
    expect(rows.rows.every((r) => r.bvn_last4 === "1111" && /^[0-9a-f]{64}$/.test(r.bvn_hmac))).toBe(true);
    expect(JSON.stringify((await db.query("SELECT raw FROM inbound_webhooks")).rows)).not.toContain("22211111111");
  });

  it("one BVN verifies one account", async () => {
    const r = await call("POST", "/v1/kyc/bvn", "did:privy:k2", person("22211111111"));
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toBe("bvn_in_use");
  });

  it("if two accounts race with the same BVN, the second is refused when Paystack answers", async () => {
    await call("POST", "/v1/kyc/bvn", "did:privy:race1", person("22233333333"));
    const c1 = funding.validations.at(-1)!.customerCode;
    await call("POST", "/v1/kyc/bvn", "did:privy:race2", person("22233333333"));
    const c2 = funding.validations.at(-1)!.customerCode;
    expect((await hook(funding.identificationEvent(c1, true))).json().result).toBe("verified");
    expect((await hook(funding.identificationEvent(c2, true))).json().result).toBe("bvn_in_use");
    expect((await call("GET", "/v1/kyc", "did:privy:race2")).json().current.tier).toBe(0);
    expect((await db.query("SELECT kind FROM ops_alerts WHERE kind = 'kyc_bvn_in_use'")).rowCount).toBe(1);
  });

  it("the account number needs a verified identity, and is named as verified", async () => {
    expect((await call("POST", "/v1/funding-account", "did:privy:k2", {})).json()).toMatchObject({ error: "verify_identity", needTier: 1 });
    const a = await call("POST", "/v1/funding-account", "did:privy:k1", {});
    expect(a.statusCode).toBe(200);
    expect(a.json().accountName).toBe("CONSTANT/CHIOMA OBI");
  });

  it("caps card top-ups by tier, and says how much is still allowed today", async () => {
    const r = await call("POST", "/v1/topups", "did:privy:k3", { amountMinor: "6000000" });
    expect(r.statusCode).toBe(403);
    expect(r.json()).toMatchObject({ error: "kyc_limit", needTier: 1, roomMinor: "5000000" });
    expect((await call("POST", "/v1/topups", "did:privy:k3", { amountMinor: "4000000" })).statusCode).toBe(200);
    expect((await call("POST", "/v1/topups", "did:privy:k1", { amountMinor: "6000000" })).statusCode).toBe(200);
  });

  it("the limit message points to the next step: verifying, or a review once verified", async () => {
    const basic = (await call("POST", "/v1/topups", "did:privy:k3", { amountMinor: "6000000" })).json().message;
    expect(basic).toMatch(/Verify your identity/);
    const verified = await call("POST", "/v1/topups", "did:privy:k1", { amountMinor: "25000000" });
    expect(verified.json().error).toBe("kyc_limit");
    expect(verified.json().message).not.toMatch(/Verify/);
    expect(verified.json().message).toMatch(/Contact support/);
  });

  it("withdrawals need a verified identity", async () => {
    const r = await call("POST", "/v1/withdrawals", "did:privy:k3", { amountMinor: "100000" });
    expect(r.json()).toMatchObject({ error: "verify_identity", needTier: 1 });
  });

  it("a transfer past the tier's limits is credited and flagged for a person", async () => {
    const id = await userId("did:privy:k1");
    const acct = (await db.query("SELECT customer_code FROM funding_accounts WHERE user_id = $1", [id])).rows[0];
    const transfer = (n: number, amount: number) =>
      hook(JSON.stringify({ event: "charge.success", data: { id: n, status: "success", channel: "dedicated_nuban", amount, currency: "NGN", reference: `t${n}`, customer: { customer_code: acct.customer_code } } }));
    expect((await transfer(9001, 10_000_000)).json().result).toBe("credited");
    expect((await db.query("SELECT 1 FROM ops_alerts WHERE kind = 'kyc_limit_exceeded'")).rowCount).toBe(0);
    expect((await transfer(9002, 15_000_000)).json().result).toBe("credited"); // ₦250,000 in a day: past Verified's ₦200,000
    const alert = (await db.query("SELECT detail FROM ops_alerts WHERE kind = 'kyc_limit_exceeded'")).rows;
    expect(alert).toHaveLength(1);
    expect(alert[0].detail).toMatchObject({ userId: id, tier: 1 });
  });

  it("D-088: a transfer from someone else's account is credited and a person takes a look; one from the holder isn't flagged", async () => {
    const id = await userId("did:privy:k1");
    const acct = (await db.query("SELECT customer_code FROM funding_accounts WHERE user_id = $1", [id])).rows[0];
    const from = (n: number, sender: string) =>
      hook(
        JSON.stringify({
          event: "charge.success",
          data: { id: n, status: "success", channel: "dedicated_nuban", amount: 100_000, currency: "NGN", reference: `s${n}`, customer: { customer_code: acct.customer_code }, authorization: { channel: "dedicated_nuban", sender_name: sender, sender_bank: "GTBank" } },
        }),
      );
    expect((await from(9101, "OBI CHIOMA ADAEZE")).json().result).toBe("credited");
    expect((await db.query("SELECT 1 FROM ops_alerts WHERE kind = 'third_party_deposit'")).rowCount).toBe(0);
    expect((await from(9102, "RANDALL AKANBI HORTON")).json().result).toBe("credited");
    const alert = (await db.query("SELECT detail FROM ops_alerts WHERE kind = 'third_party_deposit'")).rows;
    expect(alert).toHaveLength(1);
    expect(alert[0].detail).toMatchObject({ userId: id, sender: "RANDALL AKANBI HORTON", amountMinor: "100000" });
  });

  it("a person raises a tier after a review, with a reason, and it's on the record", async () => {
    const id = await userId("did:privy:k1");
    const ops = (body: unknown) => app.inject({ method: "POST", url: `/ops/users/${id}/kyc-tier`, headers: { authorization: `Bearer ${OPS}`, "content-type": "application/json", "x-ops-actor": "ada" }, payload: JSON.stringify(body) });
    expect((await ops({ tier: 2 })).json().error).toBe("note_required");
    expect((await ops({ tier: 5, note: "a reason long enough" })).json().error).toBe("invalid_tier");
    expect((await ops({ tier: 2, note: "NIN and address checked" })).json()).toEqual({ ok: true, tier: 2 });
    expect((await call("GET", "/v1/kyc", "did:privy:k1")).json().current.name).toBe("Reviewed");
    const rec = (await db.query("SELECT kind, actor, reason FROM kyc_checks WHERE user_id = $1 AND kind = 'manual'", [id])).rows[0];
    expect(rec).toEqual({ kind: "manual", actor: "ops:ada", reason: "NIN and address checked" });
  });

  it("if Paystack can't be reached, nothing is left pending", async () => {
    funding.validateFails = true;
    const r = await call("POST", "/v1/kyc/bvn", "did:privy:k4", person("22244444444"));
    funding.validateFails = false;
    expect(r.statusCode).toBe(503);
    expect((await call("GET", "/v1/kyc", "did:privy:k4")).json().check.status).toBe("failed");
    expect((await call("POST", "/v1/kyc/bvn", "did:privy:k4", person("22244444444"))).statusCode).toBe(202);
  });
});

describe("idempotency keys (D-087)", () => {
  const topups = async (did: string) => (await db.query("SELECT count(*)::int AS n FROM topups WHERE user_id = $1", [await userId(did)])).rows[0].n as number;

  it("the same request with the same key is answered once, and replayed", async () => {
    const key = { "idempotency-key": "tap-0001-abcdef" };
    const a = await call("POST", "/v1/topups", "did:privy:i1", { amountMinor: "200000" }, key);
    const b = await call("POST", "/v1/topups", "did:privy:i1", { amountMinor: "200000" }, key);
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    expect(b.json()).toEqual(a.json());
    expect(b.headers["idempotent-replayed"]).toBe("true");
    expect(await topups("did:privy:i1")).toBe(1);
  });

  it("the same key for a different request is refused", async () => {
    const r = await call("POST", "/v1/topups", "did:privy:i1", { amountMinor: "300000" }, { "idempotency-key": "tap-0001-abcdef" });
    expect(r.statusCode).toBe(422);
    expect(r.json().error).toBe("idempotency_key_reused");
    expect(await topups("did:privy:i1")).toBe(1);
  });

  it("keys belong to one user", async () => {
    const r = await call("POST", "/v1/topups", "did:privy:i2", { amountMinor: "200000" }, { "idempotency-key": "tap-0001-abcdef" });
    expect(r.statusCode).toBe(200);
    expect(await topups("did:privy:i2")).toBe(1);
  });

  it("a refusal is the answer too: retrying it doesn't change it", async () => {
    const key = { "idempotency-key": "tap-limit-000001" };
    const a = await call("POST", "/v1/topups", "did:privy:i3", { amountMinor: "6000000" }, key);
    const b = await call("POST", "/v1/topups", "did:privy:i3", { amountMinor: "6000000" }, key);
    expect([a.statusCode, b.statusCode]).toEqual([403, 403]);
    expect(b.json()).toEqual(a.json());
  });

  it("while the first is still running, a retry is told to wait", async () => {
    const id = await userId("did:privy:i4");
    const body = JSON.stringify({ amountMinor: "200000" });
    const hash = createHash("sha256").update(`POST /v1/topups\n/v1/topups\n${body}`).digest("hex");
    await db.query("INSERT INTO api_idempotency (user_id, key, route, request_hash, created_at) VALUES ($1, 'busy-key-0001', 'POST /v1/topups', $2, $3)", [id, hash, NOW]);
    const r = await call("POST", "/v1/topups", "did:privy:i4", { amountMinor: "200000" }, { "idempotency-key": "busy-key-0001" });
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toBe("in_progress");
    expect(await topups("did:privy:i4")).toBe(0);
  });

  it("browsers may send the key (CORS)", async () => {
    const r = await app.inject({ method: "OPTIONS", url: "/v1/topups", headers: { origin: "https://constant-units.vercel.app", "access-control-request-method": "POST", "access-control-request-headers": "authorization,content-type,idempotency-key" } });
    expect(String(r.headers["access-control-allow-headers"])).toContain("idempotency-key");
  });

  it("refuses a malformed key, and works without one", async () => {
    expect((await call("POST", "/v1/topups", "did:privy:i5", { amountMinor: "200000" }, { "idempotency-key": "bad key!" })).json().error).toBe("invalid_idempotency_key");
    expect((await call("POST", "/v1/topups", "did:privy:i5", { amountMinor: "200000" })).statusCode).toBe(200);
  });
});
