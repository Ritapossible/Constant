/**
 * Dollar autopay on Base (D-063) on a real Postgres with a fake chain and fake rates.
 * INV-15/45 (charge confirmed before any vend), INV-62 (USDC covers the naira), INV-63 (never above the
 * permission or the balance), INV-64 (a charge nobody can confirm goes to a person; nothing is vended).
 */
import { FakePermissionChain, STABLES } from "@constant/chains";
import { Secrets, freshDatabase, insertLine, insertPermission, ledgerSum, saveAddresses, setLineFunding, setVendingEnabled, testKeyB64, updatePermission, upsertUser, type Db } from "@constant/db";
import { FakeCableVending, FakeMessaging, FakeRates } from "@constant/partners";
import { usdcForNaira } from "@constant/rules";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { jsonLog, processOrders, processPermissions, scanRenewals, silentLog, type Deps } from "../src/index.js";

let db: Db;
let drop: () => Promise<void>;
const secrets = new Secrets({ encryption: [{ id: "k1", key: Buffer.from(testKeyB64(), "base64") }], hmac: Buffer.from(testKeyB64(), "base64") });
const T0 = new Date("2026-11-14T06:00:00Z");
const DUE = new Date("2026-11-14T23:00:00Z");
const MIN = 60_000;
const PRICE = 1_995_000n;
const RATE = 135_234n;
const USDC = STABLES.find((s) => s.key === "base-usdc")!.address;

let clock: Date;
let chain: FakePermissionChain;
let vending: FakeCableVending;
let deps: Deps;
let n = 0;

beforeAll(async () => {
  ({ db, drop } = await freshDatabase());
});
afterAll(async () => drop?.());
beforeEach(async () => {
  clock = T0;
  chain = new FakePermissionChain();
  vending = new FakeCableVending();
  deps = {
    db, vending, messaging: new FakeMessaging(), secrets, log: process.env.DEBUG_LOG ? jsonLog("t") : silentLog, now: () => clock, fallbackPhone: "08000000000",
    dollars: { chain, rates: new FakeRates("1352.34"), confirmations: 3n },
  };
  await db.query("UPDATE lines SET status = 'cancelled' WHERE status <> 'cancelled'");
  await db.query("UPDATE orders SET state = 'failed' WHERE state IN ('ready','vending','token_stored','notifying','needs_human')");
  await db.query("UPDATE spend_permissions SET status = 'revoked' WHERE status <> 'revoked'");
  await setVendingEnabled(db, true, "test", "tests");
});

async function setup(opts: { walletMicro?: bigint; allowance?: bigint; status?: "signed" | "approved" } = {}) {
  n += 1;
  const smartcard = `71${String(100000000 + n)}`;
  const account = `0x${n.toString(16).padStart(40, "a")}`;
  const user = await upsertUser(db, { privyDid: `did:privy:usd${n}`, email: `usd${n}@example.com` });
  await saveAddresses(db, user.id, [{ address: account, kind: "smart" }]);
  vending.decoders.set(smartcard, { customerName: "ADA OBI", plan: "Compact", renewalAmountMinor: PRICE, dueAt: DUE });
  const line = await insertLine(db, {
    userId: user.id, kind: "tv", provider: "dstv", refCiphertext: secrets.encrypt(smartcard), refHmac: secrets.hmac(`dstv:${smartcard}`), refLast4: smartcard.slice(-4),
    customerName: "ADA OBI", planName: "Compact", nickname: "Living room DSTV", currency: "NGN", capMinor: 2_500_000n, dueAt: DUE, nextRunAt: T0,
  });
  const perm = await insertPermission(db, {
    userId: user.id, lineId: line.id, account, spender: chain.spender, token: USDC, allowance: opts.allowance ?? 20_000_000n,
    period: 2_592_000, start: Math.floor(T0.getTime() / 1000) - 60, end: Math.floor(T0.getTime() / 1000) + 365 * 86_400, salt: BigInt(n), extraData: "0x", signature: "0xsig",
  });
  if ((opts.status ?? "approved") === "approved") await updatePermission(db, perm.id, { status: "approved" });
  await setLineFunding(db, line.id, "usdc_base");
  // The fake chain keys approvals by checksummed account and salt, like the contract hashes them.
  chain.approved.clear();
  if ((opts.status ?? "approved") === "approved") chain.approved.add(`${(await import("viem")).getAddress(account)}:${BigInt(n)}`);
  chain.balances.set((await import("viem")).getAddress(account).toLowerCase(), opts.walletMicro ?? 50_000_000n);
  return { user, line, perm, account };
}

/** Let a minute pass, then run the order loop once (the worker waits 15–30 s between chain checks). */
const tick = async (minutes = 1) => {
  clock = new Date(clock.getTime() + minutes * MIN);
  await processOrders(deps);
};

const orders = async (lineId: string) => (await db.query("SELECT * FROM orders WHERE line_id = $1 ORDER BY created_at", [lineId])).rows;
const charges = async (lineId: string) => (await db.query("SELECT c.* FROM charges c JOIN orders o ON o.id = c.order_id WHERE o.line_id = $1", [lineId])).rows;
const kinds = async (userId: string) => (await db.query("SELECT kind FROM notices WHERE user_id = $1 ORDER BY id", [userId])).rows.map((r) => r.kind);

describe("dollar autopay", () => {
  it("charges USDC first, credits exactly the naira, then renews once", async () => {
    const { user, line } = await setup();
    expect(await scanRenewals(deps)).toBe(1);
    const usdc = usdcForNaira(PRICE, RATE);

    await processOrders(deps); // charge sent
    expect(vending.calls.renew).toHaveLength(0); // INV-45: no vend before the charge is confirmed
    expect((await charges(line.id))[0]).toMatchObject({ status: "submitted", usdc_micro: usdc.toString() });

    await tick(); // confirmed → naira credited
    expect(await ledgerSum(db, user.id)).toBe(PRICE);
    expect(vending.calls.renew).toHaveLength(0);

    await tick(); // vend
    expect(vending.calls.renew).toHaveLength(1);
    expect(await ledgerSum(db, user.id)).toBe(0n);
    expect((await orders(line.id))[0].state).toBe("notifying");
    expect([...chain.spent.values()]).toEqual([usdc]);
    expect(usdc * RATE >= PRICE * 1_000_000n).toBe(true);
  });

  it("not enough USDC: asks once, charges nothing", async () => {
    const { user, line } = await setup({ walletMicro: 5_000_000n });
    expect(await scanRenewals(deps)).toBe(0);
    clock = new Date(T0.getTime() + 61 * MIN);
    await scanRenewals(deps);
    expect(await kinds(user.id)).toEqual(["stables_short"]);
    expect(await orders(line.id)).toHaveLength(0);
  });

  it("permission used up this period: asks to raise it", async () => {
    const { user } = await setup({ allowance: 5_000_000n });
    await scanRenewals(deps);
    expect(await kinds(user.id)).toEqual(["allowance_low"]);
  });

  it("permission not yet on chain: nothing is charged", async () => {
    const { user, line } = await setup({ status: "signed" });
    await scanRenewals(deps);
    expect(await orders(line.id)).toHaveLength(0);
    expect(await kinds(user.id)).toEqual(["permission_needed"]);
  });

  it("the balance drops between scan and charge: re-checked on chain, the order fails, no money moves", async () => {
    const { user, line, account } = await setup();
    await scanRenewals(deps);
    chain.balances.set((await import("viem")).getAddress(account).toLowerCase(), 1n);
    await processOrders(deps);
    expect((await orders(line.id))[0].state).toBe("failed");
    expect(chain.spent.size).toBe(0);
    expect(await ledgerSum(db, user.id)).toBe(0n);
    expect(vending.calls.renew).toHaveLength(0);
  });

  it("a reverted charge fails the order; nothing is vended", async () => {
    const { user, line } = await setup();
    chain.outcome = "reverted";
    await scanRenewals(deps);
    await processOrders(deps);
    await tick();
    expect((await orders(line.id))[0].state).toBe("failed");
    expect(await ledgerSum(db, user.id)).toBe(0n);
    expect(vending.calls.renew).toHaveLength(0);
    expect(await kinds(user.id)).toContain("renewal_failed");
  });

  it("crash while sending: the saved transaction is re-sent, never re-signed, and settles once", async () => {
    const { user, line } = await setup();
    chain.failBroadcast = 1;
    await scanRenewals(deps);
    await processOrders(deps).catch(() => undefined);
    const [c] = await charges(line.id);
    expect(c.status).toBe("submitted");
    expect(chain.txs.size).toBe(1);
    await tick(11); // not mined → re-sent after 10 min
    await tick(); // confirmed
    await tick(); // vend
    expect(chain.txs.size).toBe(1);
    expect([...chain.spent.values()]).toHaveLength(1);
    expect(vending.calls.renew).toHaveLength(1);
    expect(await ledgerSum(db, user.id)).toBe(0n);
  });

  it("INV-64: a charge nobody can confirm goes to a person; the line freezes; nothing is vended", async () => {
    const { line } = await setup();
    chain.outcome = "unknown";
    await scanRenewals(deps);
    await processOrders(deps);
    await tick(61);
    expect((await orders(line.id))[0].state).toBe("needs_human");
    expect((await db.query("SELECT status FROM lines WHERE id = $1", [line.id])).rows[0].status).toBe("frozen");
    expect(vending.calls.renew).toHaveLength(0);
  });

  it("without the dollar module configured, a dollar order is never vended", async () => {
    const { line } = await setup();
    await scanRenewals(deps);
    const { dollars: _omit, ...noDollars } = deps;
    await processOrders(noDollars);
    await processOrders(noDollars);
    expect(vending.calls.renew).toHaveLength(0);
    expect((await orders(line.id))[0].state).toBe("ready");
  });
});

describe("permission lifecycle on chain", () => {
  it("signed → approved switches the bill to USDC; stop → revoked", async () => {
    const { user, line, perm } = await setup({ status: "signed" });
    await setLineFunding(db, line.id, "naira");
    await processPermissions(deps, deps.dollars!);
    expect((await db.query("SELECT status FROM spend_permissions WHERE id = $1", [perm.id])).rows[0].status).toBe("approving");
    await processPermissions(deps, deps.dollars!);
    expect((await db.query("SELECT status FROM spend_permissions WHERE id = $1", [perm.id])).rows[0].status).toBe("approved");
    expect((await db.query("SELECT funding FROM lines WHERE id = $1", [line.id])).rows[0].funding).toBe("usdc_base");
    expect(await kinds(user.id)).toContain("permission_on");

    await updatePermission(db, perm.id, { status: "revoke_pending", tx_hash: null });
    await processPermissions(deps, deps.dollars!);
    await processPermissions(deps, deps.dollars!);
    expect((await db.query("SELECT status FROM spend_permissions WHERE id = $1", [perm.id])).rows[0].status).toBe("revoked");
    expect(chain.approved.size).toBe(0);
  });
});
