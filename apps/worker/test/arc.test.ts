/**
 * USDC on Arc (D-070) on a real Postgres with fake chains: Arc pays a bill only when configured, after the tokens on
 * Base, through the same charge-before-vend path; Constant's charged USDC moves from Arc to Base step by step.
 */
import { FakeBridge, FakePermissionChain, STABLES } from "@constant/chains";
import { Secrets, freshDatabase, insertLine, insertPermission, ledgerSum, saveAddresses, setLineFunding, setVendingEnabled, testKeyB64, updatePermission, upsertUser, type Db } from "@constant/db";
import { FakeCableVending, FakeMessaging, FakeRates } from "@constant/partners";
import { usdcForNaira } from "@constant/rules";
import { getAddress } from "viem";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ARC_GAS_RESERVE_MICRO, bridgeStep, processOrders, processPermissions, reconcileBooks, scanRenewals, silentLog, type Deps, type DollarDeps } from "../src/index.js";

let db: Db;
let drop: () => Promise<void>;
const secrets = new Secrets({ encryption: [{ id: "k1", key: Buffer.from(testKeyB64(), "base64") }], hmac: Buffer.from(testKeyB64(), "base64") });
const T0 = new Date("2026-11-14T06:00:00Z");
const DUE = new Date("2026-11-14T23:00:00Z");
const PRICE = 1_995_000n;
const RATE = 135_234n;
const BASE_USDC = STABLES.find((s) => s.key === "base-usdc")!.address;
const ARC_USDC = STABLES.find((s) => s.key === "arc-usdc")!.address;

let clock: Date;
let base: FakePermissionChain;
let arc: FakePermissionChain;
let bridge: FakeBridge;
let vending: FakeCableVending;
let deps: Deps;
let dd: DollarDeps;
let n = 0;

beforeAll(async () => {
  ({ db, drop } = await freshDatabase());
});
afterAll(async () => drop?.());
beforeEach(async () => {
  clock = T0;
  base = new FakePermissionChain("base");
  arc = new FakePermissionChain("arc");
  bridge = new FakeBridge();
  vending = new FakeCableVending();
  dd = {
    chain: base,
    rates: new FakeRates("1352.34"),
    confirmations: 3n,
    screeningRequired: false,
    dailyLimitMicro: 10n ** 12n,
    floatMarginMinor: 0n,
    sweepMinMicro: 50_000_000n,
    arc: { chain: arc, bridge, confirmations: 1n, bridgeMinMicro: 20_000_000n, bridgeMaxFeeBps: 10n },
  };
  deps = { db, vending, messaging: new FakeMessaging(), secrets, log: silentLog, now: () => clock, fallbackPhone: "08000000000", dollars: dd };
  await db.query("UPDATE lines SET status = 'cancelled' WHERE status <> 'cancelled'");
  await db.query("UPDATE orders SET state = 'failed' WHERE state IN ('ready','vending','token_stored','notifying','needs_human')");
  await db.query("UPDATE spend_permissions SET status = 'revoked' WHERE status <> 'revoked'");
  await db.query("UPDATE bridges SET status = 'done' WHERE status IN ('burning','attesting','minting')");
  await setVendingEnabled(db, true, "test", "tests");
});

async function setup() {
  n += 1;
  const smartcard = `72${String(100000000 + n)}`;
  const account = getAddress(`0x${n.toString(16).padStart(40, "c")}`);
  const user = await upsertUser(db, { privyDid: `did:privy:arc${n}`, email: `arc${n}@example.com` });
  await saveAddresses(db, user.id, [{ address: account, kind: "smart" }]);
  vending.decoders.set(smartcard, { customerName: "ADA OBI", plan: "Compact", renewalAmountMinor: PRICE, dueAt: DUE });
  const line = await insertLine(db, {
    userId: user.id, kind: "tv", provider: "dstv", refCiphertext: secrets.encrypt(smartcard), refHmac: secrets.hmac(`dstv:${smartcard}`), refLast4: smartcard.slice(-4),
    customerName: "ADA OBI", planName: "Compact", nickname: "Arc TV", currency: "NGN", capMinor: 2_500_000n, dueAt: DUE, nextRunAt: T0,
  });
  await setLineFunding(db, line.id, "stables");
  return { user, line, account };
}

async function allow(s: Awaited<ReturnType<typeof setup>>, chain: "base" | "arc", walletMicro: bigint, approved = true) {
  n += 1;
  const c = chain === "base" ? base : arc;
  const token = chain === "base" ? BASE_USDC : ARC_USDC;
  const perm = await insertPermission(db, {
    userId: s.user.id, lineId: s.line.id, chain, account: s.account, spender: c.spender, token, allowance: 20_000_000n,
    period: 2_592_000, start: Math.floor(T0.getTime() / 1000) - 60, end: Math.floor(T0.getTime() / 1000) + 365 * 86_400, salt: BigInt(50_000 + n), extraData: "0x", signature: "0xsig",
  });
  if (approved) {
    await updatePermission(db, perm.id, { status: "approved" });
    c.approved.add(`${s.account}:${BigInt(50_000 + n)}`);
  }
  c.balances.set(FakePermissionChain.balanceKey(token, s.account), walletMicro);
  return perm;
}

const charges = async (lineId: string) => (await db.query("SELECT c.* FROM charges c JOIN orders o ON o.id = c.order_id WHERE o.line_id = $1", [lineId])).rows;
const tick = async () => {
  clock = new Date(clock.getTime() + 60_000);
  await processOrders(deps);
};

describe("USDC on Arc pays bills (D-070)", () => {
  it("charges on Arc when Base can't pay, credits the naira, renews once", async () => {
    const s = await setup();
    await allow(s, "base", 0n);
    const perm = await allow(s, "arc", 50_000_000n);
    expect(await scanRenewals(deps)).toBe(1);
    const usdc = usdcForNaira(PRICE, RATE);
    expect((await charges(s.line.id))[0]).toMatchObject({ permission_id: perm.id, chain: "arc", token: ARC_USDC, amount_micro: usdc.toString() });
    await processOrders(deps); // charge sent on Arc
    expect(base.txs.size).toBe(0);
    await tick(); // confirmed → naira credited
    await tick(); // vend
    expect(vending.calls.renew).toHaveLength(1);
    expect(await ledgerSum(db, s.user.id)).toBe(0n);
    expect(await arc.balanceOf(ARC_USDC, arc.spender)).toBe(usdc);
    expect(await arc.balanceOf(ARC_USDC, s.account)).toBe(50_000_000n - usdc);
    // Reconciliation checks the charge on Arc, where it happened: the books balance.
    const r = await reconcileBooks(deps, true);
    expect(r).toMatchObject({ ran: true, ok: true });
    await db.query("UPDATE system_flags SET value = true WHERE key IN ('vending_enabled','dollar_charges_enabled')");
  });

  it("tokens on Base go first", async () => {
    const s = await setup();
    await allow(s, "base", 50_000_000n);
    await allow(s, "arc", 50_000_000n);
    await scanRenewals(deps);
    expect((await charges(s.line.id))[0].chain).toBe("base");
  });

  it("with Arc not configured, an Arc permission is never used and never registered", async () => {
    const { arc: _off, ...baseOnly } = dd;
    deps = { ...deps, dollars: baseOnly };
    const s = await setup();
    const perm = await allow(s, "arc", 50_000_000n, false);
    await processPermissions(deps, baseOnly);
    expect((await db.query("SELECT status FROM spend_permissions WHERE id = $1", [perm.id])).rows[0].status).toBe("signed");
    await updatePermission(db, perm.id, { status: "approved" });
    await scanRenewals(deps);
    expect(await charges(s.line.id)).toHaveLength(0);
    expect(arc.txs.size).toBe(0);
  });

  it("registers an Arc permission on Arc, not on Base", async () => {
    const s = await setup();
    await setLineFunding(db, s.line.id, "naira");
    const perm = await allow(s, "arc", 0n, false);
    await processPermissions(deps, dd);
    await processPermissions(deps, dd);
    expect((await db.query("SELECT status FROM spend_permissions WHERE id = $1", [perm.id])).rows[0].status).toBe("approved");
    expect([...arc.txs.values()].map((t) => t.kind)).toEqual(["approve"]);
    expect(base.txs.size).toBe(0);
    const notice = (await db.query("SELECT params FROM notices WHERE user_id = $1 AND kind = 'permission_on'", [s.user.id])).rows[0];
    expect(notice.params).toMatchObject({ symbol: "USDC", network: "Arc" });
  });
});

describe("moving charged USDC from Arc to Base (D-070)", () => {
  it("keeps gas back, burns, waits for Circle, mints on Base: each step saved before it's sent", async () => {
    bridge.arcBalance = 50_000_000n;
    expect(await bridgeStep(deps, dd)).toBe("started");
    const row = (await db.query("SELECT * FROM bridges WHERE status = 'burning'")).rows[0];
    expect(row.amount_micro).toBe((50_000_000n - ARC_GAS_RESERVE_MICRO).toString());
    expect(bridge.arcBalance).toBe(ARC_GAS_RESERVE_MICRO);
    expect(await bridgeStep(deps, dd)).toBe("attesting");
    expect(await bridgeStep(deps, dd)).toBe("attesting"); // Circle hasn't attested yet
    bridge.attested.add(row.burn_hash);
    expect(await bridgeStep(deps, dd)).toBe("minting");
    expect((await db.query("SELECT mint_hash, attestation FROM bridges WHERE id = $1", [row.id])).rows[0].mint_hash).toBeTruthy();
    expect(await bridgeStep(deps, dd)).toBe("done");
    expect(bridge.baseMinted).toBe(49_000_000n);
    expect(await bridgeStep(deps, dd)).toBe("too_small"); // only the gas reserve is left
  });

  it("one transfer at a time", async () => {
    bridge.arcBalance = 100_000_000n;
    bridge.outcome = "pending";
    expect(await bridgeStep(deps, dd)).toBe("started");
    expect(await bridgeStep(deps, dd)).toBe("burning");
    expect((await db.query("SELECT count(*)::int AS n FROM bridges WHERE status IN ('burning','attesting','minting')")).rows[0].n).toBe(1);
  });

  it("never pays Circle more than the cap", async () => {
    bridge.arcBalance = 100_000_000n;
    bridge.feeBps = 50; // 0.5%, above the 0.1% cap
    expect(await bridgeStep(deps, dd)).toBe("fee_too_high");
    expect(bridge.txs.size).toBe(0);
  });

  it("a reverted burn fails cleanly: nothing left Arc, a person is told", async () => {
    bridge.arcBalance = 100_000_000n;
    bridge.outcome = "reverted";
    await bridgeStep(deps, dd);
    expect(await bridgeStep(deps, dd)).toBe("failed");
    expect((await db.query("SELECT count(*)::int AS n FROM ops_alerts WHERE kind = 'bridge_failed'")).rows[0].n).toBeGreaterThan(0);
  });

  it("off without Arc", async () => {
    const { arc: _off, ...baseOnly } = dd;
    expect(await bridgeStep(deps, baseOnly)).toBe("off");
  });
});
