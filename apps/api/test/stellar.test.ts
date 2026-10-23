/**
 * USDC on Stellar (D-085): linking an account by signature, sponsored onboarding, and the per-bill mandate the user
 * signs. FakeStellarRail stands in for the network; signatures are real ed25519 signatures by a Stellar key.
 */
import { FakeStellarRail, stellarMessageHash } from "@constant/chains";
import { Secrets, freshDatabase, testKeyB64, type Db } from "@constant/db";
import { FakeCableVending, FakeFunding, FakeIdentity, FakeRates } from "@constant/partners";
import { Keypair } from "@stellar/stellar-sdk";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/index.js";

let db: Db;
let drop: () => Promise<void>;
let app: FastifyInstance;
const NOW = new Date("2026-11-10T09:00:00Z");
const rail = new FakeStellarRail(() => NOW);
const vending = new FakeCableVending();
const user = Keypair.random();
const sign = (kp: Keypair, payloadHex: string) => Buffer.from(kp.sign(Buffer.from(payloadHex, "hex"))).toString("hex");

beforeAll(async () => {
  ({ db, drop } = await freshDatabase());
  vending.decoders.set("7012345678", { customerName: "ADA OBI", plan: "DStv Compact", renewalAmountMinor: 1_995_000n, dueAt: new Date("2026-11-14T23:00:00Z") });
  app = await buildApp({
    db,
    identity: new FakeIdentity(),
    vending,
    funding: new FakeFunding("whsec"),
    secrets: new Secrets({ encryption: [{ id: "k1", key: Buffer.from(testKeyB64(), "base64") }], hmac: Buffer.from(testKeyB64(), "base64") }),
    webOrigins: ["https://constant-units.vercel.app"],
    vtpassWebhookToken: "vt-0123456789abcdef",
    fundingEmailDomain: "users.example",
    now: () => NOW,
    logger: false,
    stellar: { rail, rates: new FakeRates("1352.34") },
  });
});
afterAll(async () => {
  await app?.close();
  await drop?.();
});

const call = (method: "GET" | "POST" | "DELETE", url: string, did: string, body?: unknown) =>
  app.inject({ method, url, headers: { authorization: `Bearer fake:${did}`, "content-type": "application/json" }, ...(body !== undefined ? { payload: JSON.stringify(body) } : {}) });

describe("USDC on Stellar", () => {
  const did = "did:privy:stellar";
  let lineId = "";

  it("says whether it's on, and which contract", async () => {
    const r = (await call("GET", "/v1/stellar", did)).json();
    expect(r).toMatchObject({ available: true, network: "testnet", account: null, ready: false, contract: rail.contractId });
  });

  it("links an account only with a signature by that account over the message it was given", async () => {
    const ch = (await call("POST", "/v1/stellar/link/challenge", did, { account: user.publicKey() })).json();
    expect(ch.message).toContain(user.publicKey());
    expect(ch.payload).toBe(stellarMessageHash(ch.message));
    // Another key's signature, a malformed one, then the right one (as base64, as wallets return it).
    expect((await call("POST", "/v1/stellar/link", did, { requestId: ch.requestId, signature: sign(Keypair.random(), ch.payload) })).json().error).toBe("invalid_signature");
    expect((await call("POST", "/v1/stellar/link", did, { requestId: ch.requestId, signature: "nope" })).json().error).toBe("invalid_signature");
    const b64 = Buffer.from(sign(user, ch.payload), "hex").toString("base64");
    const ok = await call("POST", "/v1/stellar/link", did, { requestId: ch.requestId, signature: b64 });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ account: user.publicKey(), ready: false });
    // Each request is used once.
    expect((await call("POST", "/v1/stellar/link", did, { requestId: ch.requestId, signature: b64 })).statusCode).toBe(410);
  });

  it("refuses an account already linked to someone else", async () => {
    const ch = (await call("POST", "/v1/stellar/link/challenge", "did:privy:other", { account: user.publicKey() })).json();
    const r = await call("POST", "/v1/stellar/link", "did:privy:other", { requestId: ch.requestId, signature: sign(user, ch.payload) });
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toBe("account_taken");
  });

  it("won't propose a mandate before the account can hold USDC", async () => {
    const l = await call("POST", "/v1/lines", did, { provider: "dstv", smartcard: "7012345678", nickname: "TV", capMinor: "2500000" });
    lineId = l.json().id;
    expect((await call("POST", `/v1/lines/${lineId}/stellar/proposal`, did)).json().error).toBe("stellar_not_ready");
  });

  it("opens the account for USDC with Constant paying every reserve; the user only signs the hash", async () => {
    const ob = (await call("POST", "/v1/stellar/onboarding", did)).json();
    expect(ob).toMatchObject({ ready: false, network: "testnet" });
    expect(ob.hash).toMatch(/^[0-9a-f]{64}$/);
    expect((await call("POST", "/v1/stellar/onboarding/submit", did, { requestId: ob.requestId, signature: sign(Keypair.random(), ob.hash) })).json().error).toBe("invalid_signature");
    const ok = (await call("POST", "/v1/stellar/onboarding/submit", did, { requestId: ob.requestId, signature: sign(user, ob.hash) })).json();
    expect(ok).toMatchObject({ account: user.publicKey(), ready: true, txHash: ob.hash });
    expect((await call("POST", "/v1/stellar/onboarding", did)).json()).toEqual({ ready: true });
  });

  it("proposes a capped mandate for the bill and stores it once the user signs", async () => {
    const p = (await call("POST", `/v1/lines/${lineId}/stellar/proposal`, did)).json();
    expect(p).toMatchObject({ network: "testnet", contract: rail.contractId, display: { capUsd: "19.97", periodDays: 30 } });
    expect(p.payload).toMatch(/^[0-9a-f]{64}$/);
    expect((await call("POST", `/v1/lines/${lineId}/stellar`, did, { requestId: p.requestId, signature: sign(Keypair.random(), p.payload) })).json().error).toBe("invalid_signature");
    const ok = await call("POST", `/v1/lines/${lineId}/stellar`, did, { requestId: p.requestId, signature: sign(user, p.payload) });
    expect(ok.statusCode).toBe(202);
    const row = (await db.query("SELECT * FROM spend_permissions WHERE line_id = $1", [lineId])).rows[0];
    expect(row).toMatchObject({ chain: "stellar", account: user.publicKey(), spender: rail.contractId, token: rail.usdcContract, allowance: "19970000", status: "signed" });
    const extra = JSON.parse(row.extra_data);
    expect(extra.entry).toBeTruthy();
    expect(extra.validUntilLedger).toBeGreaterThan(rail.ledger);
    expect((await call("GET", `/v1/lines/${lineId}/stellar`, did)).json()).toMatchObject({ available: true, permission: { status: "signed", capUsd: "19.97", periodDays: 30 } });
    // A second one for the same bill is refused.
    const again = (await call("POST", `/v1/lines/${lineId}/stellar/proposal`, did)).json();
    expect((await call("POST", `/v1/lines/${lineId}/stellar`, did, { requestId: again.requestId, signature: sign(user, again.payload) })).statusCode).toBe(409);
  });

  it("stopping is immediate in Constant; the worker revokes it on chain", async () => {
    expect((await call("DELETE", `/v1/lines/${lineId}/stellar`, did)).statusCode).toBe(204);
    const row = (await db.query("SELECT status FROM spend_permissions WHERE line_id = $1", [lineId])).rows[0];
    expect(row.status).toBe("revoked"); // never registered on chain, so nothing to revoke there
  });

  it("another user's bill is not reachable", async () => {
    expect((await call("POST", `/v1/lines/${lineId}/stellar/proposal`, "did:privy:intruder")).statusCode).toBe(404);
  });
});
