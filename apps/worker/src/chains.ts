/**
 * Chain jobs. Read-only on Base and Arc (deposits into users' own accounts); write-only-proofs on Stellar
 * (receipt roots). Neither job moves a user's money.
 */
import {
  EVM_CHAINS,
  STABLES,
  formatUnits6,
  merkle,
  receiptLeaf,
  stableFor,
  type Anchorer,
  type EvmReader,
} from "@constant/chains";
import {
  allEvmAddresses,
  claimUnanchored,
  insertBatch,
  insertDeposit,
  lockCursor,
  markBatch,
  pendingBatches,
  queueNotice,
  raiseOpsAlert,
  setCursor,
  withTx,
  type Db,
} from "@constant/db";
import type { Address } from "viem";
import type { Log } from "./log.js";

export interface ChainDeps {
  db: Db;
  log: Log;
  readers: EvmReader[];
  anchorer: Anchorer | null;
  /**
   * Also record transfers of tokens we don't accept, to warn the user (INV-46). Needs an RPC that allows
   * log queries without a contract filter (a paid Base endpoint); public RPCs refuse them.
   */
  scanAllTokens?: boolean;
}

/**
 * One pass per chain: read transfers into known addresses from the cursor up to the confirmed head,
 * record each once, tell the user, move the cursor, all in one transaction. A crash re-reads the same
 * range and inserts nothing twice.
 */
export async function indexDeposits(d: ChainDeps): Promise<number> {
  let found = 0;
  for (const reader of d.readers) {
    try {
      found += await indexChain(d, reader);
    } catch (err) {
      d.log.error("deposit indexing failed", { chain: reader.chain, err: (err as Error).message });
    }
  }
  return found;
}

async function indexChain(d: ChainDeps, reader: EvmReader): Promise<number> {
  const cfg = EVM_CHAINS[reader.chain];
  const head = await reader.head();
  const safe = head - cfg.confirmations;
  return withTx(d.db, async (tx) => {
    const cursor = await lockCursor(tx, reader.chain);
    // First run: start at the confirmed head. Older history isn't scanned (no addresses existed yet).
    if (cursor === null) {
      await setCursor(tx, reader.chain, safe);
      return 0;
    }
    const from = cursor + 1n;
    if (from > safe) return 0;
    const to = safe < from + cfg.maxLogRange - 1n ? safe : from + cfg.maxLogRange - 1n;

    const owners = await allEvmAddresses(tx);
    let inserted = 0;
    if (owners.size > 0) {
      const tokens = d.scanAllTokens ? undefined : STABLES.filter((t) => t.chain === reader.chain).map((t) => t.address);
      const logs = await reader.transfersTo([...owners.keys()] as Address[], from, to, tokens);
      for (const l of logs) {
        const userId = owners.get(l.to.toLowerCase());
        if (!userId) continue;
        const stable = stableFor(reader.chain, l.token);
        const isNew = await insertDeposit(tx, {
          chain: reader.chain,
          txHash: l.txHash,
          logIndex: l.logIndex,
          userId,
          address: l.to,
          from: l.from,
          token: l.token,
          tokenKey: stable?.key ?? null,
          amountRaw: l.value,
          blockNumber: l.blockNumber,
        });
        if (!isNew) continue;
        inserted += 1;
        if (stable) {
          if (l.value === 0n) continue; // zero-value transfers are a known spam pattern; record, don't notify
          await queueNotice(tx, {
            key: `notice:stables:${reader.chain}:${l.txHash}:${l.logIndex}`,
            userId,
            kind: "stables_arrived",
            params: { amount: formatUnits6(l.value), symbol: stable.symbol, network: cfg.name },
          });
        } else {
          // Tell the user once per chain per day at most: spam tokens arrive in bursts.
          const day = new Date().toISOString().slice(0, 10);
          await queueNotice(tx, {
            key: `notice:quarantine:${userId}:${reader.chain}:${day}`,
            userId,
            kind: "token_quarantined",
            params: { network: cfg.name },
          });
        }
      }
    }
    await setCursor(tx, reader.chain, to);
    if (inserted) d.log.info("deposits recorded", { chain: reader.chain, inserted, from: from.toString(), to: to.toString() });
    return inserted;
  });
}

/** Stops a batch that can't be anchored from retrying silently forever. */
export const MAX_ANCHOR_ATTEMPTS = 12;

/**
 * Batch every settled renewal not yet anchored into one Merkle tree, save the batch and every proof,
 * then write the root to Stellar. Saving first means a crash or a Horizon outage only delays the
 * anchor; the next pass retries pending batches before making new ones.
 */
export async function anchorReceipts(d: ChainDeps): Promise<{ batches: number; receipts: number }> {
  if (!d.anchorer) return { batches: 0, receipts: 0 };
  const anchorer = d.anchorer;

  const made = await withTx(d.db, async (tx) => {
    const rows = await claimUnanchored(tx);
    if (rows.length === 0) return 0;
    const leaves = rows.map((r) =>
      receiptLeaf({ receiptId: r.receipt_id, amountMinor: r.amount_minor, currency: r.currency, provider: r.provider, last4: r.last4, settledAt: r.settled_at }),
    );
    const { root, proofs } = merkle(leaves);
    await insertBatch(tx, anchorer.network, root, rows.map((r, i) => ({ orderId: r.order_id, leaf: leaves[i]!, proof: proofs[i]! })));
    return rows.length;
  });

  let anchored = 0;
  for (const b of await pendingBatches(d.db)) {
    if (b.attempts >= MAX_ANCHOR_ATTEMPTS) continue;
    try {
      const r = await anchorer.anchor(b.root);
      await markBatch(d.db, b.id, { anchored: true, txHash: r.txHash, ledger: r.ledger });
      anchored += 1;
      d.log.info("receipts anchored", { batch: b.id.toString(), txHash: r.txHash });
    } catch (err) {
      await markBatch(d.db, b.id, { anchored: false, error: (err as Error).message.slice(0, 500) });
      if (b.attempts + 1 >= MAX_ANCHOR_ATTEMPTS) await raiseOpsAlert(d.db, "warn", "anchor_failing", { batch: b.id.toString(), err: (err as Error).message });
    }
  }
  return { batches: anchored, receipts: made };
}

export { STABLES };
