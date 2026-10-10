/**
 * Worker invariants on a real Postgres with fake partners.
 * INV-7 (no double vend), INV-8 (crash recovery, ambiguity → a person), INV-13 (only delivered settles),
 * INV-23 (notices once), INV-38/39 (paused, cap), INV-50 to 53 (renewals).
 */
import {
  Secrets,
  freshDatabase,
  insertLedger,
  insertLine,
  ledgerSum,
  setVendingEnabled,
  testKeyB64,
  upsertUser,
  vendingEnabled,
  type Db,
} from "@constant/db";
import { FakeCableVending, FakeMessaging } from "@constant/partners";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CHECK_BACKOFF_MIN, applyOutcome, nudgeOrder, processOrders, recover, scanRenewals, sendNotices, silentLog, type Deps } from "../src/index.js";

let db: Db;
let drop: () => Promise<void>;
const secrets = new Secrets({ encryption: [{ id: "k1", key: Buffer.from(testKeyB64(), "base64") }], hmac: Buffer.from(testKeyB64(), "base64") });

// 07:00 Lagos on the 14th; the subscription ends at midnight starting the 15th.
const T0 = new Date("2026-11-14T06:00:00Z");
const DUE = new Date("2026-11-14T23:00:00Z");
const MIN = 60_000;

let clock: Date;
let vending: FakeCableVending;
let messaging: FakeMessaging;
let deps: Deps;
let n = 0;

beforeAll(async () => {
  ({ db, drop } = await freshDatabase());
  await setVendingEnabled(db, true, "test", "tests");
});
afterAll(async () => drop?.());

beforeEach(async () => {
  clock = T0;
  vending = new FakeCableVending();
  messaging = new FakeMessaging();
  deps = { db, vending, messaging, secrets, log: silentLog, now: () => clock, fallbackPhone: "08000000000" };
  // Each test uses its own users and lines. Deactivate earlier tests' lines so scans only see this test's.
  await db.query("UPDATE lines SET status = 'cancelled' WHERE status <> 'cancelled'");
  await db.query("UPDATE orders SET state = 'failed' WHERE state IN ('ready','vending','token_stored','notifying','needs_human')");
  await db.query("UPDATE notices SET status = 'failed' WHERE status = 'pending'");
  await setVendingEnabled(db, true, "test", "tests");
});

async function setup(opts: { fundMinor?: bigint; capMinor?: bigint; priceMinor?: bigint; dueAt?: Date; smartcard?: string } = {}) {
  n += 1;
  const smartcard = opts.smartcard ?? `70${String(100000000 + n)}`;
  const user = await upsertUser(db, { privyDid: `did:privy:w${n}`, email: `w${n}@example.com` });
  if (opts.fundMinor) {
    await insertLedger(db, { userId: user.id, kind: "fund", amountMinor: opts.fundMinor, currency: "NGN", idempotencyKey: `test:fund:${n}`, actor: "test" });
  }
  vending.decoders.set(smartcard, { customerName: "ADA OBI", plan: "Compact", renewalAmountMinor: opts.priceMinor ?? 1_995_000n, dueAt: opts.dueAt ?? DUE });
  const line = await insertLine(db, {
    userId: user.id,
    kind: "tv",
    provider: "dstv",
    refCiphertext: secrets.encrypt(smartcard),
    refHmac: secrets.hmac(`dstv:${smartcard}`),
    refLast4: smartcard.slice(-4),
    customerName: "ADA OBI",
    planName: "Compact",
    nickname: "Living room DSTV",
    currency: "NGN",
    capMinor: opts.capMinor ?? 2_500_000n,
    dueAt: DUE,
    nextRunAt: T0,
  });
  return { user, line, smartcard };
}

const orders = async (lineId: string) => (await db.query("SELECT * FROM orders WHERE line_id = $1 ORDER BY created_at", [lineId])).rows;
const lineRow = async (id: string) => (await db.query("SELECT * FROM lines WHERE id = $1", [id])).rows[0];
const notices = async (userId: string) => (await db.query("SELECT kind, status FROM notices WHERE user_id = $1 ORDER BY id", [userId])).rows;
const alerts = async (kind: string) => (await db.query("SELECT * FROM ops_alerts WHERE kind = $1", [kind])).rows;

describe("happy path: one DSTV renewal end to end", () => {
  it("renews once, debits once, moves to next month, tells the user, settles", async () => {
    const { user, line, smartcard } = await setup({ fundMinor: 5_000_000n });

    expect(await scanRenewals(deps)).toBe(1);
    await processOrders(deps);

    expect(vending.calls.renew).toHaveLength(1);
    expect(vending.calls.renew[0]).toMatchObject({ smartcard, amountMinor: 1_995_000n });
    expect(await ledgerSum(db, user.id)).toBe(5_000_000n - 1_995_000n);

    const [o] = await orders(line.id);
    expect(o.state).toBe("notifying");
    const l = await lineRow(line.id);
    expect(l.last_renewed_at.toISOString()).toBe(T0.toISOString());
    expect(l.next_run_at.toISOString()).toBe("2026-12-14T06:00:00.000Z"); // 07:00 the day before the next end

    expect(await sendNotices(deps)).toBe(1);
    expect(messaging.sent[0]).toMatchObject({ channel: "email", to: user.email });
    expect(messaging.sent[0]!.text).toContain("₦19,950");
    expect(messaging.sent[0]!.text).not.toContain(smartcard);
    expect((await orders(line.id))[0].state).toBe("settled");

    // Scanning again the same day does nothing.
    clock = new Date(T0.getTime() + 10 * MIN);
    expect(await scanRenewals(deps)).toBe(0);
    await processOrders(deps);
    expect(vending.calls.renew).toHaveLength(1);
  });
});

describe("safety", () => {
  it("the kill switch stops everything", async () => {
    const { line } = await setup({ fundMinor: 5_000_000n });
    await setVendingEnabled(db, false, "test", "off");
    expect(await scanRenewals(deps)).toBe(0);
    expect(await orders(line.id)).toHaveLength(0);
  });

  it("INV-38: a paused line is never paid", async () => {
    const { line } = await setup({ fundMinor: 5_000_000n });
    await db.query("UPDATE lines SET status = 'paused' WHERE id = $1", [line.id]);
    expect(await scanRenewals(deps)).toBe(0);
    expect(vending.calls.renew).toHaveLength(0);
  });

  it("a line paused after its order was created is not paid", async () => {
    const { line } = await setup({ fundMinor: 5_000_000n });
    await scanRenewals(deps);
    await db.query("UPDATE lines SET status = 'paused' WHERE id = $1", [line.id]);
    await processOrders(deps);
    expect(vending.calls.renew).toHaveLength(0);
    expect((await orders(line.id))[0].state).toBe("failed");
  });

  it("INV-7: five scans at once create one order and one partner call", async () => {
    const { line } = await setup({ fundMinor: 5_000_000n });
    await Promise.all(Array.from({ length: 5 }, () => scanRenewals(deps)));
    await Promise.all(Array.from({ length: 5 }, () => processOrders(deps)));
    expect(await orders(line.id)).toHaveLength(1);
    expect(vending.calls.renew).toHaveLength(1);
  });

  it("INV-52: two bills due together, money for one: only one is bought", async () => {
    const a = await setup({ fundMinor: 2_500_000n });
    // A second line for the same user.
    const smartcard = "7099999999";
    vending.decoders.set(smartcard, { customerName: "ADA OBI", plan: "Compact", renewalAmountMinor: 1_995_000n, dueAt: DUE });
    await insertLine(db, {
      userId: a.user.id, kind: "tv", provider: "gotv", refCiphertext: secrets.encrypt(smartcard), refHmac: secrets.hmac(`gotv:${smartcard}`), refLast4: "9999",
      customerName: "ADA OBI", planName: "Max", nickname: "Bedroom GOtv", currency: "NGN", capMinor: 2_500_000n, dueAt: DUE, nextRunAt: T0,
    });
    expect(await scanRenewals(deps)).toBe(1);
    const kinds = (await notices(a.user.id)).map((x) => x.kind);
    expect(kinds).toEqual(["insufficient"]);
  });
});

describe("money and price (INV-39, INV-23)", () => {
  it("not enough money: tells the user once, then renews when money arrives the same day", async () => {
    const { user, line } = await setup({ fundMinor: 1_000_000n });
    expect(await scanRenewals(deps)).toBe(0);
    clock = new Date(T0.getTime() + 61 * MIN);
    expect(await scanRenewals(deps)).toBe(0);
    expect(await notices(user.id)).toEqual([{ kind: "insufficient", status: "pending" }]);

    await insertLedger(db, { userId: user.id, kind: "fund", amountMinor: 1_000_000n, currency: "NGN", idempotencyKey: `test:topup:${line.id}`, actor: "test" });
    clock = new Date(T0.getTime() + 125 * MIN);
    expect(await scanRenewals(deps)).toBe(1);
    await processOrders(deps);
    expect(vending.calls.renew).toHaveLength(1);
  });

  it("a price above the cap is asked about, never paid", async () => {
    const { user } = await setup({ fundMinor: 5_000_000n, capMinor: 1_900_000n });
    expect(await scanRenewals(deps)).toBe(0);
    expect(vending.calls.renew).toHaveLength(0);
    expect((await notices(user.id)).map((x) => x.kind)).toEqual(["above_cap"]);
  });

  it("INV-51: renewed elsewhere → not paid, moved to the day before the new end", async () => {
    const { line } = await setup({ fundMinor: 5_000_000n, dueAt: new Date("2026-12-09T23:00:00Z") });
    expect(await scanRenewals(deps)).toBe(0);
    const l = await lineRow(line.id);
    expect(l.next_run_at.toISOString()).toBe("2026-12-09T06:00:00.000Z");
  });

  it("the partner can't be reached for a price: nothing is bought", async () => {
    const { line } = await setup({ fundMinor: 5_000_000n });
    vending.lookupUnreachable = true;
    expect(await scanRenewals(deps)).toBe(0);
    expect(await orders(line.id)).toHaveLength(0);
  });
});

describe("INV-8: crashes and unclear answers never pay twice", () => {
  it("crash after the request left: restart asks, never re-sends, settles once", async () => {
    const { user, line } = await setup({ fundMinor: 5_000_000n });
    vending.renewScript = ["throw"];
    await scanRenewals(deps);
    await processOrders(deps).catch(() => undefined);
    expect((await orders(line.id))[0].state).toBe("vending");
    expect((await orders(line.id))[0].partner_ref).toBeTruthy();
    expect(await ledgerSum(db, user.id)).toBe(5_000_000n); // nothing debited yet

    await recover(deps);
    await processOrders(deps);
    expect(vending.calls.renew).toHaveLength(1);
    expect(vending.calls.requery).toHaveLength(1);
    expect((await orders(line.id))[0].state).toBe("notifying");
    expect(await ledgerSum(db, user.id)).toBe(5_000_000n - 1_995_000n);
  });

  it("pending, then delivered on requery", async () => {
    const { user, line } = await setup({ fundMinor: 5_000_000n });
    vending.renewScript = [{ kind: "pending", detail: "pending" }];
    vending.requeryScript = [{ kind: "pending", detail: "pending" }, { kind: "delivered", partnerTxnId: "T9" }];
    await scanRenewals(deps);
    await processOrders(deps);
    for (const wait of CHECK_BACKOFF_MIN.slice(0, 2)) {
      clock = new Date(clock.getTime() + wait * MIN);
      await processOrders(deps);
    }
    const [o] = await orders(line.id);
    expect(o.state).toBe("notifying");
    expect(o.partner_txn_id).toBe("T9");
    expect(await ledgerSum(db, user.id)).toBe(5_000_000n - 1_995_000n);
  });

  it("still unclear after every recheck: a person decides, the line freezes, no money moves", async () => {
    const { user, line } = await setup({ fundMinor: 5_000_000n });
    vending.renewScript = [{ kind: "unknown", detail: "timeout" }];
    vending.requeryScript = Array.from({ length: 10 }, () => ({ kind: "pending" as const, detail: "pending" }));
    await scanRenewals(deps);
    await processOrders(deps);
    for (let i = 0; i < 10; i++) {
      clock = new Date(clock.getTime() + 31 * MIN);
      await processOrders(deps);
    }
    expect((await orders(line.id))[0].state).toBe("needs_human");
    expect((await lineRow(line.id)).status).toBe("frozen");
    expect(await alerts("order_needs_human")).not.toHaveLength(0);
    expect(await ledgerSum(db, user.id)).toBe(5_000_000n);
    expect(vending.calls.renew).toHaveLength(1);
  });

  it("a webhook nudge and a requery racing settle once", async () => {
    const { user, line } = await setup({ fundMinor: 5_000_000n });
    vending.renewScript = [{ kind: "pending", detail: "pending" }];
    await scanRenewals(deps);
    await processOrders(deps);
    const [o] = await orders(line.id);
    await nudgeOrder(db, o.partner_ref, clock);
    await Promise.all([
      applyOutcome(deps, o.id, { kind: "delivered", partnerTxnId: "A" }, "requery"),
      applyOutcome(deps, o.id, { kind: "delivered", partnerTxnId: "B" }, "requery"),
    ]);
    expect(await ledgerSum(db, user.id)).toBe(5_000_000n - 1_995_000n);
  });
});

describe("failures", () => {
  it("a definite failure takes no money, tells the user, retries later; three in a cycle freezes the line", async () => {
    const { user, line } = await setup({ fundMinor: 5_000_000n });
    vending.renewScript = Array.from({ length: 3 }, () => ({ kind: "failed" as const, code: "016", detail: "TRANSACTION FAILED" }));
    for (let i = 0; i < 3; i++) {
      expect(await scanRenewals(deps)).toBe(1);
      await processOrders(deps);
      clock = new Date(clock.getTime() + 121 * MIN);
    }
    expect(await ledgerSum(db, user.id)).toBe(5_000_000n);
    expect((await orders(line.id)).map((o) => o.state)).toEqual(["failed", "failed", "failed"]);
    expect((await lineRow(line.id)).status).toBe("frozen");
    expect(await alerts("renewal_failing")).not.toHaveLength(0);
    expect((await notices(user.id)).filter((x) => x.kind === "renewal_failed").length).toBeGreaterThanOrEqual(1);
  });

  it("our partner balance empty (018): all vending stops and a person is paged", async () => {
    await setup({ fundMinor: 5_000_000n });
    vending.renewScript = [{ kind: "failed", code: "018", detail: "LOW WALLET BALANCE" }];
    await scanRenewals(deps);
    await processOrders(deps);
    expect(await vendingEnabled(db)).toBe(false);
    expect(await alerts("partner_balance_low")).not.toHaveLength(0);
  });

  it("'never received' is only believed after several rechecks", async () => {
    const { user, line } = await setup({ fundMinor: 5_000_000n });
    vending.renewScript = [{ kind: "unknown", detail: "timeout" }];
    vending.requeryScript = Array.from({ length: 5 }, () => ({ kind: "not_found" as const }));
    await scanRenewals(deps);
    await processOrders(deps);
    clock = new Date(clock.getTime() + 2 * MIN);
    await processOrders(deps);
    expect((await orders(line.id))[0].state).toBe("vending");
    for (let i = 0; i < 4; i++) {
      clock = new Date(clock.getTime() + 11 * MIN);
      await processOrders(deps);
    }
    expect((await orders(line.id))[0].state).toBe("failed");
    expect(await ledgerSum(db, user.id)).toBe(5_000_000n);
  });
});

describe("notices", () => {
  it("a message that fails is retried, and the order still settles after the last try", async () => {
    const { line } = await setup({ fundMinor: 5_000_000n });
    await scanRenewals(deps);
    await processOrders(deps);
    messaging.failNext = 100;
    for (let i = 0; i < 6; i++) {
      await sendNotices(deps);
      clock = new Date(clock.getTime() + 100 * MIN);
    }
    expect((await orders(line.id))[0].state).toBe("settled");
  });
});
