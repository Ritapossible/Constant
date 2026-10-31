/**
 * USDC on Stellar through the mandate contract (D-085), on a real Postgres with FakeStellarRail (the contract's rules
 * in memory). The same pipeline as Base: the charge is confirmed before any vend, saved before it is sent, and a
 * transaction the network never includes is built again rather than handed to a person.
 */
import { FakeStellarRail } from "@constant/chains";
import { Secrets, freshDatabase, insertLine, insertPermission, ledgerSum, setLineFunding, setVendingEnabled, testKeyB64, upsertUser, type Db } from "@constant/db";
import { FakeCableVending, FakeMessaging, FakeRates } from "@constant/partners";
import { usdcForNaira } from "@constant/rules";
import { Keypair } from "@stellar/stellar-sdk";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { jsonLog, processOrders, processPermissions, scanRenewals, silentLog, type Deps } from "../src/index.js";
import { stellarChargeId, stellarMandateId } from "../src/rails.js";

let db: Db;
let drop: () => Promise<void>;
const secrets = new Secrets({ encryption: [{ id: "k1", key: Buffer.from(testKeyB64(), "base64") }], hmac: Buffer.from(testKeyB64(), "base64") });
const T0 = new Date("2026-11-14T06:00:00Z");
const DUE = new Date("2026-11-14T23:00:00Z");
const MIN = 60_000;
const PRICE = 1_995_000n;
const RATE = 135_234n;

let clock: Date;
let rail: FakeStellarRail;
let vending: FakeCableVending;
let deps: Deps;
let n = 0;

beforeAll(async () => {
  ({ db, drop } = await freshDatabase());
});
afterAll(async () => drop?.());
beforeEach(async () => {
  clock = T0;
  rail = new FakeStellarRail(() => clock);
  vending = new FakeCableVending();
  deps = {
    db, vending, messaging: new FakeMessaging(), secrets, log: process.env.DEBUG_LOG ? jsonLog("t") : silentLog, now: () => clock, fallbackPhone: "08000000000",
    // Stellar only: no Base key at all, as on a testnet deployment.
    dollars: { stellar: { rail }, rates: new FakeRates("1352.34"), confirmations: 3n, screeningRequired: false, dailyLimitMicro: 10n ** 12n, floatMarginMinor: 0n, sweepMinMicro: 50_000_000n },
  };
  await db.query("UPDATE lines SET status = 'cancelled' WHERE status <> 'cancelled'");
  await db.query("UPDATE orders SET state = 'failed' WHERE state IN ('ready','vending','token_stored','notifying','needs_human')");
  await db.query("UPDATE spend_permissions SET status = 'revoked' WHERE status <> 'revoked'");
  await setVendingEnabled(db, true, "test", "tests");
});

async function setup(opts: { walletMicro?: bigint; capMicro?: bigint; validUntilLedger?: number } = {}) {
  n += 1;
  const smartcard = `72${String(100000000 + n)}`;
  const owner = Keypair.random().publicKey();
  const user = await upsertUser(db, { privyDid: `did:privy:xlm${n}`, email: `xlm${n}@example.com` });
  vending.decoders.set(smartcard, { customerName: "ADA OBI", plan: "Compact", renewalAmountMinor: PRICE, dueAt: DUE });
  const line = await insertLine(db, {
    userId: user.id, kind: "tv", provider: "dstv", refCiphertext: secrets.encrypt(smartcard), refHmac: secrets.hmac(`dstv:${smartcard}`), refLast4: smartcard.slice(-4),
    customerName: "ADA OBI", planName: "Compact", nickname: "Living room DSTV", currency: "NGN", capMinor: 2_500_000n, dueAt: DUE, nextRunAt: T0,
  });
  const id = randomBytes(32).toString("hex");
  const start = Math.floor(T0.getTime() / 1000);
  const perm = await insertPermission(db, {
    userId: user.id, lineId: line.id, chain: "stellar", account: owner, spender: rail.contractId, token: rail.usdcContract,
    allowance: opts.capMicro ?? 20_000_000n, period: 2_592_000, start, end: start + 115 * 86_400, salt: BigInt("0x" + id),
    extraData: JSON.stringify({ entry: "signed-entry", expiryLedger: rail.ledger + 2_000_000, validUntilLedger: opts.validUntilLedger ?? rail.ledger + 1_440 }),
    signature: "ab".repeat(64),
  });
  rail.balances.set(owner, opts.walletMicro ?? 50_000_000n);
  return { user, line, perm, owner, id };
}

const tick = async (minutes = 1) => {
  clock = new Date(clock.getTime() + minutes * MIN);
  await processOrders(deps);
};
const permRow = async (id: string) => (await db.query("SELECT status, tx_hash, error FROM spend_permissions WHERE id = $1", [id])).rows[0];
const lineFunding = async (id: string) => (await db.query("SELECT funding FROM lines WHERE id = $1", [id])).rows[0].funding;
const charges = async (lineId: string) => (await db.query("SELECT c.* FROM charges c JOIN orders o ON o.id = c.order_id WHERE o.line_id = $1", [lineId])).rows;
const orders = async (lineId: string) => (await db.query("SELECT * FROM orders WHERE line_id = $1 ORDER BY created_at", [lineId])).rows;
const kinds = async (userId: string) => (await db.query("SELECT kind FROM notices WHERE user_id = $1 ORDER BY id", [userId])).rows.map((r) => r.kind);

describe("USDC on Stellar", () => {
  it("registers the signed mandate, then the bill pays from Stellar", async () => {
    const { user, line, perm, id } = await setup();
    await processPermissions(deps, deps.dollars!); // create() saved, then sent
    expect((await permRow(perm.id)).status).toBe("approving");
    expect(rail.sent.map((t) => t.fn)).toEqual(["create"]);
    await processPermissions(deps, deps.dollars!); // confirmed
    expect((await permRow(perm.id)).status).toBe("approved");
    expect(await lineFunding(line.id)).toBe("stables");
    expect(await rail.isActive(id)).toBe(true);
    expect(await kinds(user.id)).toEqual(["permission_on"]);
  });

  it("charges USDC to the treasury before the vend, credits exactly the naira, once", async () => {
    const { user, line, perm, owner, id } = await setup();
    await processPermissions(deps, deps.dollars!);
    await processPermissions(deps, deps.dollars!);
    expect(await scanRenewals(deps)).toBe(1);
    const usdc = usdcForNaira(PRICE, RATE);

    await processOrders(deps); // charge saved, then sent: it lands at once on the fake
    expect(vending.calls.renew).toHaveLength(0);
    const [c] = await charges(line.id);
    expect(c).toMatchObject({ status: "submitted", chain: "stellar", token: rail.usdcContract, amount_micro: usdc.toString() });
    expect(rail.chargeIds.has(stellarChargeId(c.order_id))).toBe(true);

    await tick(); // confirmed → naira credited
    expect(await ledgerSum(db, user.id)).toBe(PRICE);
    expect(vending.calls.renew).toHaveLength(0);
    const fund = await db.query("SELECT actor, external_ref FROM ledger_entries WHERE user_id = $1 AND kind = 'fund'", [user.id]);
    expect(fund.rows[0]).toMatchObject({ actor: "stellar", external_ref: c.tx_hash });

    await tick(); // vend
    expect(vending.calls.renew).toHaveLength(1);
    expect(rail.treasuryMicro).toBe(usdc);
    expect(await rail.balanceMicro(owner)).toBe(50_000_000n - usdc);
    expect((await rail.getMandate(id))!.spentMicro).toBe(usdc);
    expect(stellarMandateId(perm)).toBe(id);
    // The person is told what left their own account (D-093).
    const renewed = (await db.query("SELECT params FROM notices WHERE user_id = $1 AND kind = 'renewed'", [user.id])).rows;
    expect(renewed).toHaveLength(1);
    expect(renewed[0].params.paidWith).toBe(`${usdc / 1_000_000n}.${((usdc % 1_000_000n) / 10_000n).toString().padStart(2, "0")} USDC on Stellar`);
    expect(renewed[0].params.paidWith).toBe("14.75 USDC on Stellar");
  });

  it("in production on testnet it still charges: testnet USDC isn't screened (D-090)", async () => {
    deps.dollars = { ...deps.dollars!, screeningRequired: true };
    const { user } = await setup();
    await processPermissions(deps, deps.dollars!);
    await processPermissions(deps, deps.dollars!);
    await scanRenewals(deps);
    await tick();
    await tick();
    expect(rail.treasuryMicro).toBe(usdcForNaira(PRICE, RATE));
    expect(await ledgerSum(db, user.id)).toBe(PRICE); // credited, ready to pay the bill
  });

  it("in production on the public network an unscreened Stellar account is never charged (D-090)", async () => {
    rail.network = "public";
    deps.dollars = { ...deps.dollars!, screeningRequired: true };
    const { line } = await setup();
    await processPermissions(deps, deps.dollars!);
    await processPermissions(deps, deps.dollars!);
    await scanRenewals(deps);
    await tick();
    await tick();
    expect(rail.treasuryMicro).toBe(0n);
    expect(rail.sent.filter((t) => t.fn === "charge")).toHaveLength(0);
    expect((await charges(line.id)).every((c) => c.status !== "confirmed")).toBe(true);
  });

  it("a charge the network never includes is built again after its time limit, and charges once", async () => {
    const { user, line } = await setup();
    await processPermissions(deps, deps.dollars!);
    await processPermissions(deps, deps.dollars!);
    await scanRenewals(deps);
    rail.dropNext = true;
    await processOrders(deps);
    const first = (await charges(line.id))[0];
    expect(first.status).toBe("submitted");
    await tick(2); // still within its 5 minutes
    expect((await charges(line.id))[0].tx_hash).toBe(first.tx_hash);
    await tick(6); // past the limit: expired, back to pending
    expect((await charges(line.id))[0]).toMatchObject({ status: "pending", tx_hash: null });
    await tick(); // built and sent again
    await tick(); // confirmed
    await tick(); // vend
    const [c] = await charges(line.id);
    expect(c.status).toBe("confirmed");
    expect(c.tx_hash).not.toBe(first.tx_hash);
    expect(rail.treasuryMicro).toBe(usdcForNaira(PRICE, RATE));
    expect(vending.calls.renew).toHaveLength(1);
    expect((await orders(line.id))[0].state).toBe("notifying");
    expect(await ledgerSum(db, user.id)).toBe(0n);
  });

  it("over this period's cap: asks the user to raise it, charges nothing", async () => {
    const { user, line } = await setup({ capMicro: 5_000_000n });
    await processPermissions(deps, deps.dollars!);
    await processPermissions(deps, deps.dollars!);
    await scanRenewals(deps);
    expect(await kinds(user.id)).toEqual(["permission_on", "allowance_low"]);
    expect(await orders(line.id)).toHaveLength(0);
    expect(rail.treasuryMicro).toBe(0n);
  });

  it("not enough USDC on Stellar: tells the user what to add", async () => {
    const { user, line } = await setup({ walletMicro: 1_000_000n });
    await processPermissions(deps, deps.dollars!);
    await processPermissions(deps, deps.dollars!);
    await scanRenewals(deps);
    expect(await kinds(user.id)).toEqual(["permission_on", "stables_short"]);
    const notice = await db.query("SELECT params FROM notices WHERE user_id = $1 AND kind = 'stables_short'", [user.id]);
    expect(notice.rows[0].params.symbol).toBe("USDC on Stellar");
    expect(await orders(line.id)).toHaveLength(0);
  });

  it("revoked on chain from the user's own wallet: no charge, the bill goes back to naira", async () => {
    const { line, perm, id } = await setup();
    await processPermissions(deps, deps.dollars!);
    await processPermissions(deps, deps.dollars!);
    await scanRenewals(deps);
    rail.mandates.get(id)!.revoked = true;
    await processOrders(deps);
    expect((await orders(line.id))[0].state).toBe("failed");
    expect(rail.treasuryMicro).toBe(0n);
    expect((await permRow(perm.id)).status).toBe("revoked");
    expect(await lineFunding(line.id)).toBe("naira");
  });

  it("stopping in the app revokes the mandate on chain", async () => {
    const { perm, id } = await setup();
    await processPermissions(deps, deps.dollars!);
    await processPermissions(deps, deps.dollars!);
    await db.query("UPDATE spend_permissions SET status = 'revoke_pending', tx_hash = NULL, tx_raw = NULL WHERE id = $1", [perm.id]);
    await processPermissions(deps, deps.dollars!);
    await processPermissions(deps, deps.dollars!);
    expect((await permRow(perm.id)).status).toBe("revoked");
    expect(await rail.isActive(id)).toBe(false);
  });

  it("a signature that lapsed before it was registered: failed, and the user is asked to sign again", async () => {
    const { user, perm } = await setup({ validUntilLedger: rail.ledger - 1 });
    await processPermissions(deps, deps.dollars!);
    expect(await permRow(perm.id)).toMatchObject({ status: "failed", error: "signature lapsed before it was registered" });
    expect(rail.sent).toHaveLength(0);
    expect(await kinds(user.id)).toEqual(["permission_failed"]);
  });

  it("a create the network never includes goes back to signed and is sent again", async () => {
    const { perm } = await setup();
    rail.dropNext = true;
    await processPermissions(deps, deps.dollars!);
    const first = (await permRow(perm.id)).tx_hash;
    clock = new Date(clock.getTime() + 6 * MIN);
    await processPermissions(deps, deps.dollars!);
    expect(await permRow(perm.id)).toMatchObject({ status: "signed", tx_hash: null });
    await processPermissions(deps, deps.dollars!);
    await processPermissions(deps, deps.dollars!);
    const row = await permRow(perm.id);
    expect(row.status).toBe("approved");
    expect(row.tx_hash).not.toBe(first);
  });

  it("charge ids are 32 bytes from the order id, the same every time", () => {
    const a = stellarChargeId("6f1c2a6e-1b34-4c55-9d1f-000000000001");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(stellarChargeId("6f1c2a6e-1b34-4c55-9d1f-000000000001")).toBe(a);
    expect(stellarChargeId("6f1c2a6e-1b34-4c55-9d1f-000000000002")).not.toBe(a);
  });
});
