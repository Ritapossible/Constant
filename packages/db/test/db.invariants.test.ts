/**
 * Database invariants: INV-6/20 (one open order per line under concurrency), INV-7 (idempotent ledger and orders),
 * append-only ledger, funding replays credit once, INV-52 (committed money).
 */
import { renewalOrderKey } from "@constant/rules";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  Secrets,
  committedToOpenOrders,
  freshDatabase,
  insertLedger,
  insertLine,
  insertOrder,
  ledgerSum,
  lockUser,
  receiptId,
  recordFunding,
  testKeyB64,
  upsertUser,
  vendingEnabled,
  withTx,
  writeVendEntries,
  type Db,
} from "../src/index.js";

let db: Db;
let drop: () => Promise<void>;
const secrets = new Secrets({ encryption: [{ id: "k1", key: Buffer.from(testKeyB64(), "base64") }], hmac: Buffer.from(testKeyB64(), "base64") });

beforeAll(async () => {
  ({ db, drop } = await freshDatabase());
});
afterAll(async () => drop?.());

async function userAndLine(did: string) {
  const user = await upsertUser(db, { privyDid: did, email: `${did}@example.com` });
  const line = await insertLine(db, {
    userId: user.id,
    kind: "tv",
    provider: "dstv",
    refCiphertext: secrets.encrypt("7012345678"),
    refHmac: secrets.hmac("dstv:7012345678"),
    refLast4: "5678",
    customerName: "ADA OBI",
    planName: "Compact",
    nickname: "Living room",
    currency: "NGN",
    capMinor: 2_500_000n,
    dueAt: new Date("2026-11-15T06:00:00Z"),
    nextRunAt: new Date("2026-11-14T06:00:00Z"),
  });
  return { user, line };
}

describe("schema", () => {
  it("vending starts switched off", async () => {
    expect(await vendingEnabled(db)).toBe(false);
  });

  it("ledger is append-only", async () => {
    const { user } = await userAndLine("did:privy:append");
    await insertLedger(db, { userId: user.id, kind: "adjust", amountMinor: 100n, currency: "NGN", idempotencyKey: "t:append", actor: "test" });
    await expect(db.query("UPDATE ledger_entries SET amount_minor = 5 WHERE idempotency_key = 't:append'")).rejects.toThrow(/append-only/);
    await expect(db.query("DELETE FROM ledger_entries WHERE idempotency_key = 't:append'")).rejects.toThrow(/append-only/);
    await expect(db.query("TRUNCATE ledger_entries CASCADE")).rejects.toThrow(/append-only/);
  });

  it("money comes back as bigint", async () => {
    const { user } = await userAndLine("did:privy:bigint");
    await insertLedger(db, { userId: user.id, kind: "adjust", amountMinor: 9_007_199_254_740_993n, currency: "NGN", idempotencyKey: "t:big", actor: "test" });
    expect(await ledgerSum(db, user.id)).toBe(9_007_199_254_740_993n);
  });

  it("the same decoder cannot be added twice to one account", async () => {
    const { user } = await userAndLine("did:privy:dupe");
    await expect(
      insertLine(db, {
        userId: user.id, kind: "tv", provider: "dstv", refCiphertext: "x", refHmac: secrets.hmac("dstv:7012345678"), refLast4: "5678",
        customerName: null, planName: null, nickname: "again", currency: "NGN", capMinor: 1n, dueAt: null, nextRunAt: null,
      }),
    ).rejects.toThrow(/already/);
  });
});

describe("INV-20 / INV-6: one open order per line, even with 50 concurrent scans", () => {
  it("exactly one order is created", async () => {
    const { user, line } = await userAndLine("did:privy:race");
    const runAt = new Date("2026-11-14T06:00:00Z");
    const attempts = Array.from({ length: 50 }, (_, i) =>
      withTx(db, async (tx) => {
        await lockUser(tx, user.id);
        // Half use the cycle key, half a different key: the partial unique index must still hold.
        const key = i % 2 === 0 ? renewalOrderKey(line.id, runAt) : `${renewalOrderKey(line.id, runAt)}:${i}`;
        return insertOrder(tx, {
          userId: user.id, lineId: line.id, amountMinor: 1_995_000n, feeMinor: 0n, currency: "NGN",
          idempotencyKey: key, scheduledFor: runAt, partner: "fake", receiptId: receiptId(),
        });
      }),
    );
    const results = await Promise.all(attempts);
    expect(results.filter(Boolean)).toHaveLength(1);
    const count = await db.query("SELECT count(*)::int AS n FROM orders WHERE line_id = $1", [line.id]);
    expect(count.rows[0].n).toBe(1);
  });
});

describe("INV-52: committed money", () => {
  it("an open order holds its amount until its vend entry is written, then the ledger carries it", async () => {
    const { user, line } = await userAndLine("did:privy:commit");
    await insertLedger(db, { userId: user.id, kind: "fund", amountMinor: 5_000_000n, currency: "NGN", idempotencyKey: "t:fund:commit", actor: "test" });
    const order = await withTx(db, (tx) =>
      insertOrder(tx, {
        userId: user.id, lineId: line.id, amountMinor: 1_995_000n, feeMinor: 10_000n, currency: "NGN",
        idempotencyKey: "t:order:commit", scheduledFor: new Date(), partner: "fake", receiptId: receiptId(),
      }),
    );
    expect(await committedToOpenOrders(db, user.id)).toBe(2_005_000n);
    await withTx(db, (tx) => writeVendEntries(tx, order!, "ref-1"));
    await withTx(db, (tx) => writeVendEntries(tx, order!, "ref-1")); // replay writes nothing
    expect(await committedToOpenOrders(db, user.id)).toBe(0n);
    expect(await ledgerSum(db, user.id)).toBe(5_000_000n - 2_005_000n);
  });
});

describe("INV-7: a replayed funding webhook credits once", () => {
  it("credits once, then reports duplicate", async () => {
    const { user } = await userAndLine("did:privy:fund");
    const event = { provider: "paystack", eventId: "evt-1", userId: user.id, amountMinor: 1_000_000n, currency: "NGN", credit: true };
    expect(await withTx(db, (tx) => recordFunding(tx, event))).toBe("credited");
    expect(await withTx(db, (tx) => recordFunding(tx, event))).toBe("duplicate");
    const replays = await Promise.all(Array.from({ length: 10 }, () => withTx(db, (tx) => recordFunding(tx, event))));
    expect(replays.every((r) => r === "duplicate")).toBe(true);
    expect(await ledgerSum(db, user.id)).toBe(1_000_000n);
  });
});

describe("secrets", () => {
  it("round-trips and never stores the plain number", () => {
    const sealed = secrets.encrypt("7012345678");
    expect(sealed).not.toContain("7012345678");
    expect(secrets.decrypt(sealed)).toBe("7012345678");
    expect(secrets.hmac("a")).toBe(secrets.hmac("a"));
  });
  it("receipt ids are long and distinct", () => {
    const a = receiptId();
    expect(a.length).toBeGreaterThanOrEqual(22);
    expect(a).not.toBe(receiptId());
  });
});
