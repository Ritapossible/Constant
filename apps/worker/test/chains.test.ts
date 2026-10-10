/**
 * Chain jobs on a real Postgres with fake chains.
 * INV-46 (only listed stables accepted, others quarantined), INV-58 (each deposit recorded and told once,
 * only after confirmations), INV-59 (every settled receipt is provable against an anchored root).
 */
import { FakeAnchorer, FakeReader, STABLES, leafHash, receiptLeaf, verifyProof, type TransferLog } from "@constant/chains";
import { freshDatabase, insertLine, publicReceipt, saveAddresses, upsertUser, type Db } from "@constant/db";
import type { Address } from "viem";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MAX_ANCHOR_ATTEMPTS, anchorReceipts, indexDeposits, silentLog } from "../src/index.js";

let db: Db;
let drop: () => Promise<void>;
beforeAll(async () => {
  ({ db, drop } = await freshDatabase());
});
afterAll(async () => drop?.());

const ALICE: Address = "0x1111111111111111111111111111111111111111";
const STRANGER: Address = "0x2222222222222222222222222222222222222222";
const SPAM: Address = "0x9999999999999999999999999999999999999999";
const usdc = STABLES.find((s) => s.key === "base-usdc")!.address;

let n = 0;
const transfer = (over: Partial<TransferLog>): TransferLog => ({
  chain: "base",
  token: usdc,
  from: STRANGER,
  to: ALICE,
  value: 20_000_000n,
  txHash: `0x${(++n).toString(16).padStart(64, "0")}`,
  logIndex: 0,
  blockNumber: 1_000n,
  ...over,
});

const notices = async (userId: string) => (await db.query("SELECT kind, params FROM notices WHERE user_id = $1 ORDER BY id", [userId])).rows;

describe("deposit indexer", () => {
  it("starts at the confirmed head, then records each deposit once, after confirmations, and tells the user", async () => {
    const alice = await upsertUser(db, { privyDid: "did:privy:dep-alice" });
    await saveAddresses(db, alice.id, [{ address: ALICE, kind: "embedded" }]);
    const base = new FakeReader("base");
    const arc = new FakeReader("arc");
    const deps = { db, log: silentLog, readers: [base, arc], anchorer: null };

    base.height = 1_000n;
    await indexDeposits(deps); // first pass only sets the cursor at 1000 - 12

    base.logs.push(transfer({ blockNumber: 995n, value: 20_000_000n }));
    base.logs.push(transfer({ blockNumber: 1_005n, value: 5_000_000n })); // not yet 12 deep
    base.height = 1_010n;
    expect(await indexDeposits(deps)).toBe(1);

    base.height = 1_017n;
    expect(await indexDeposits(deps)).toBe(1);
    expect(await indexDeposits(deps)).toBe(0); // re-run: nothing twice

    const kinds = await notices(alice.id);
    expect(kinds.map((k) => k.params.amount)).toEqual(["20.00", "5.00"]);
    expect(kinds[0].params).toMatchObject({ symbol: "USDC", network: "Base" });
  });

  it("INV-46: an unknown token is recorded as quarantined, never as a stable, and the user is warned once a day", async () => {
    const bob = await upsertUser(db, { privyDid: "did:privy:dep-bob" });
    const BOB: Address = "0x3333333333333333333333333333333333333333";
    await saveAddresses(db, bob.id, [{ address: BOB, kind: "embedded" }]);
    const arc = new FakeReader("arc");
    const deps = { db, log: silentLog, readers: [arc], anchorer: null, scanAllTokens: true };
    arc.height = 5_000n;
    await db.query("DELETE FROM chain_cursors WHERE chain = 'arc'");
    await indexDeposits(deps);
    // USDT's Base address on Arc is NOT Arc USDC: quarantined.
    arc.logs.push(transfer({ chain: "arc", to: BOB, token: SPAM, blockNumber: 5_001n }));
    arc.logs.push(transfer({ chain: "arc", to: BOB, token: SPAM, blockNumber: 5_001n, logIndex: 1 }));
    arc.logs.push(transfer({ chain: "arc", to: BOB, token: STABLES[1]!.address, blockNumber: 5_001n, logIndex: 2 }));
    arc.logs.push(transfer({ chain: "arc", to: BOB, token: "0x3600000000000000000000000000000000000000", value: 1_500_000n, blockNumber: 5_001n, logIndex: 3 }));
    arc.height = 5_001n; // Arc is final: no confirmations to wait for
    expect(await indexDeposits(deps)).toBe(4);
    const rows = (await db.query("SELECT status, token_key FROM chain_deposits WHERE user_id = $1 ORDER BY log_index", [bob.id])).rows;
    expect(rows.map((r) => r.status)).toEqual(["quarantined", "quarantined", "quarantined", "accepted"]);
    expect(rows[3].token_key).toBe("arc-usdc");
    const k = (await notices(bob.id)).map((x) => x.kind);
    expect(k.filter((x) => x === "token_quarantined")).toHaveLength(1);
    expect(k.filter((x) => x === "stables_arrived")).toHaveLength(1);
  });

  it("by default only the accepted contracts are queried, so public RPCs work", async () => {
    const cat = await upsertUser(db, { privyDid: "did:privy:dep-cat" });
    const CAT: Address = "0x4444444444444444444444444444444444444444";
    await saveAddresses(db, cat.id, [{ address: CAT, kind: "embedded" }]);
    const arc = new FakeReader("arc");
    arc.height = 9_000n;
    await db.query("DELETE FROM chain_cursors WHERE chain = 'arc'");
    await indexDeposits({ db, log: silentLog, readers: [arc], anchorer: null });
    arc.logs.push(transfer({ chain: "arc", to: CAT, token: SPAM, blockNumber: 9_001n }));
    arc.logs.push(transfer({ chain: "arc", to: CAT, token: "0x3600000000000000000000000000000000000000", blockNumber: 9_001n, logIndex: 1 }));
    arc.height = 9_001n;
    expect(await indexDeposits({ db, log: silentLog, readers: [arc], anchorer: null })).toBe(1);
  });

  it("an address can belong to only one user", async () => {
    const eve = await upsertUser(db, { privyDid: "did:privy:dep-eve" });
    expect((await saveAddresses(db, eve.id, [{ address: ALICE, kind: "external" }])).conflicts).toEqual([ALICE]);
  });

  it("reads large gaps in bounded ranges", async () => {
    const base = new FakeReader("base");
    base.height = 1_017n + 5_000n;
    await indexDeposits({ db, log: silentLog, readers: [base], anchorer: null });
    expect(base.calls.at(-1)!.to - base.calls.at(-1)!.from).toBeLessThan(2_000n);
  });
});

describe("receipt anchoring (Stellar)", () => {
  async function settledOrder(i: number) {
    const u = await upsertUser(db, { privyDid: `did:privy:anchor-${i}` });
    const line = await insertLine(db, {
      userId: u.id, kind: "tv", provider: "dstv", refCiphertext: "x", refHmac: `h${i}`, refLast4: "5678", customerName: null, planName: null,
      nickname: "TV", currency: "NGN", capMinor: 2_000_000n, dueAt: null, nextRunAt: null,
    });
    const r = await db.query(
      `INSERT INTO orders (user_id, line_id, trigger, state, amount_minor, fee_minor, currency, idempotency_key, partner, receipt_id, settled_at)
       VALUES ($1,$2,'renewal','settled',1995000,0,'NGN',$3,'fake',$4, now()) RETURNING receipt_id`,
      [u.id, line.id, `anchor-order-${i}`, `RCPT${String(i).padStart(18, "0")}`],
    );
    return r.rows[0].receipt_id as string;
  }

  it("INV-59: batches settled receipts, anchors the root once, and each receipt's proof checks out", async () => {
    const ids = await Promise.all([1, 2, 3, 4, 5].map(settledOrder));
    const anchorer = new FakeAnchorer();
    const deps = { db, log: silentLog, readers: [], anchorer };

    expect(await anchorReceipts(deps)).toEqual({ batches: 1, receipts: 5 });
    expect(anchorer.roots).toHaveLength(1);
    expect(await anchorReceipts(deps)).toEqual({ batches: 0, receipts: 0 }); // nothing twice

    for (const id of ids) {
      const r = (await publicReceipt(db, id))!;
      const leaf = receiptLeaf({ receiptId: r.receipt_id, amountMinor: r.amount_minor, currency: r.currency, provider: r.provider, last4: r.last4, settledAt: r.settled_at! });
      expect(r.leaf).toBe(leaf);
      expect(verifyProof(leaf, r.proof!, r.root!)).toBe(true);
      expect(r.root).toBe(anchorer.roots[0]);
      expect(r.tx_hash).toBeTruthy();
    }
    expect(verifyProof(leafHash("forged"), (await publicReceipt(db, ids[0]!))!.proof!, anchorer.roots[0]!)).toBe(false);
  });

  it("an outage delays the anchor; the saved batch is retried, not rebuilt", async () => {
    await settledOrder(6);
    const anchorer = new FakeAnchorer();
    anchorer.failNext = true;
    const deps = { db, log: silentLog, readers: [], anchorer };
    expect(await anchorReceipts(deps)).toEqual({ batches: 0, receipts: 1 });
    expect(await anchorReceipts(deps)).toEqual({ batches: 1, receipts: 0 });
    expect(anchorer.roots).toHaveLength(1);
    expect(MAX_ANCHOR_ATTEMPTS).toBeGreaterThan(1);
  });
});
