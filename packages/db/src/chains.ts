/** Repositories for addresses, deposits and receipt anchors. */
import type { Q, Tx } from "./pool.js";

export interface AddressRow {
  family: "evm";
  address: string;
  user_id: string;
  kind: "embedded" | "external" | "smart";
}

/** Records addresses for a user. An address already owned by someone else is left alone and reported. */
export async function saveAddresses(q: Q, userId: string, addresses: { address: string; kind: "embedded" | "external" | "smart" }[]): Promise<{ conflicts: string[] }> {
  const conflicts: string[] = [];
  for (const a of addresses) {
    const r = await q.query<{ user_id: string }>(
      `INSERT INTO user_addresses (family, address, user_id, kind) VALUES ('evm', $1, $2, $3)
       ON CONFLICT (family, address) DO UPDATE SET kind = user_addresses.kind RETURNING user_id`,
      [a.address, userId, a.kind],
    );
    if (r.rows[0]?.user_id !== userId) conflicts.push(a.address);
  }
  return { conflicts };
}

export async function addressesOf(q: Q, userId: string): Promise<AddressRow[]> {
  return (await q.query<AddressRow>("SELECT family, address, user_id, kind FROM user_addresses WHERE user_id = $1 ORDER BY created_at", [userId])).rows;
}

export async function allEvmAddresses(q: Q): Promise<Map<string, string>> {
  const r = await q.query<{ address: string; user_id: string }>("SELECT address, user_id FROM user_addresses WHERE family = 'evm'");
  return new Map(r.rows.map((x) => [x.address.toLowerCase(), x.user_id]));
}

export async function getCursor(q: Q, chain: string): Promise<bigint | null> {
  const r = await q.query<{ last_block: bigint }>("SELECT last_block FROM chain_cursors WHERE chain = $1", [chain]);
  return r.rows[0]?.last_block ?? null;
}

export async function lockCursor(tx: Tx, chain: string): Promise<bigint | null> {
  const r = await tx.query<{ last_block: bigint }>("SELECT last_block FROM chain_cursors WHERE chain = $1 FOR UPDATE", [chain]);
  return r.rows[0]?.last_block ?? null;
}

export async function setCursor(q: Q, chain: string, block: bigint): Promise<void> {
  await q.query(
    `INSERT INTO chain_cursors (chain, last_block) VALUES ($1, $2)
     ON CONFLICT (chain) DO UPDATE SET last_block = $2, updated_at = now()`,
    [chain, block],
  );
}

export interface NewDeposit {
  chain: string;
  txHash: string;
  logIndex: number;
  userId: string;
  address: string;
  from: string;
  token: string;
  tokenKey: string | null;
  amountRaw: bigint;
  blockNumber: bigint;
}

/** Inserts once per (chain, tx, log). Returns true if new. */
export async function insertDeposit(q: Q, d: NewDeposit): Promise<boolean> {
  const r = await q.query(
    `INSERT INTO chain_deposits (chain, tx_hash, log_index, user_id, address, from_address, token, token_key, amount_raw, status, block_number)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT DO NOTHING`,
    [d.chain, d.txHash, d.logIndex, d.userId, d.address, d.from, d.token, d.tokenKey, d.amountRaw.toString(), d.tokenKey ? "accepted" : "quarantined", d.blockNumber],
  );
  return r.rowCount === 1;
}

export interface DepositRow {
  chain: string;
  tx_hash: string;
  log_index: number;
  token: string;
  token_key: string | null;
  amount_raw: string;
  status: "accepted" | "quarantined";
  created_at: Date;
}

export async function depositsOf(q: Q, userId: string, limit = 30): Promise<DepositRow[]> {
  return (
    await q.query<DepositRow>(
      "SELECT chain, tx_hash, log_index, token, token_key, amount_raw, status, created_at FROM chain_deposits WHERE user_id = $1 ORDER BY created_at DESC, log_index DESC LIMIT $2",
      [userId, limit],
    )
  ).rows;
}

// ── Anchors ──────────────────────────────────────────────────────────────────

export interface UnanchoredReceipt {
  order_id: string;
  receipt_id: string;
  amount_minor: bigint;
  currency: string;
  provider: string;
  last4: string;
  settled_at: Date;
}

/** Settled orders not yet in any batch, locked so two workers can't batch the same order. */
export async function claimUnanchored(tx: Tx, limit = 1000): Promise<UnanchoredReceipt[]> {
  return (
    await tx.query<UnanchoredReceipt>(
      `SELECT o.id AS order_id, o.receipt_id, o.amount_minor, o.currency, l.provider, l.ref_last4 AS last4, o.settled_at
       FROM orders o JOIN lines l ON l.id = o.line_id
       WHERE o.state = 'settled' AND o.settled_at IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM anchor_items a WHERE a.order_id = o.id)
       ORDER BY o.settled_at LIMIT $1 FOR UPDATE OF o SKIP LOCKED`,
      [limit],
    )
  ).rows;
}

export async function insertBatch(tx: Tx, network: string, root: string, items: { orderId: string; leaf: string; proof: string[] }[]): Promise<bigint> {
  const r = await tx.query<{ id: bigint }>("INSERT INTO anchor_batches (network, root, leaf_count, status) VALUES ($1,$2,$3,'pending') RETURNING id", [network, root, items.length]);
  const id = r.rows[0]!.id;
  for (const it of items) {
    await tx.query("INSERT INTO anchor_items (order_id, batch_id, leaf, proof) VALUES ($1,$2,$3,$4)", [it.orderId, id, it.leaf, JSON.stringify(it.proof)]);
  }
  return id;
}

export interface BatchRow {
  id: bigint;
  network: string;
  root: string;
  status: "pending" | "anchored";
  tx_hash: string | null;
  ledger: number | null;
  attempts: number;
  anchored_at: Date | null;
}

export async function pendingBatches(q: Q): Promise<BatchRow[]> {
  return (await q.query<BatchRow>("SELECT * FROM anchor_batches WHERE status = 'pending' ORDER BY id")).rows;
}

export async function markBatch(q: Q, id: bigint, patch: { anchored: true; txHash: string; ledger: number | null } | { anchored: false; error: string }): Promise<void> {
  if (patch.anchored) {
    await q.query("UPDATE anchor_batches SET status = 'anchored', tx_hash = $2, ledger = $3, anchored_at = now(), attempts = attempts + 1, error = NULL WHERE id = $1", [id, patch.txHash, patch.ledger]);
  } else {
    await q.query("UPDATE anchor_batches SET attempts = attempts + 1, error = $2 WHERE id = $1", [id, patch.error]);
  }
}

export interface PublicReceipt {
  receipt_id: string;
  state: string;
  amount_minor: bigint;
  currency: string;
  provider: string;
  last4: string;
  created_at: Date;
  settled_at: Date | null;
  leaf: string | null;
  proof: string[] | null;
  root: string | null;
  network: string | null;
  tx_hash: string | null;
  anchored_at: Date | null;
}

/** What the public receipt page may show: no name, no full number, no phone (ARCHITECTURE "Security"). */
export async function publicReceipt(q: Q, receiptId: string): Promise<PublicReceipt | null> {
  const r = await q.query<PublicReceipt>(
    `SELECT o.receipt_id, o.state, o.amount_minor, o.currency, l.provider, l.ref_last4 AS last4, o.created_at, o.settled_at,
            a.leaf, a.proof, b.root, b.network, b.tx_hash, b.anchored_at
     FROM orders o JOIN lines l ON l.id = o.line_id
     LEFT JOIN anchor_items a ON a.order_id = o.id
     LEFT JOIN anchor_batches b ON b.id = a.batch_id AND b.status = 'anchored'
     WHERE o.receipt_id = $1`,
    [receiptId],
  );
  return r.rows[0] ?? null;
}
