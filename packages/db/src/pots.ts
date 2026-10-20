/**
 * Pots (D-083). Balances come from the ledger: a pot is the sum of its entries, free money the sum of the user's
 * entries in no pot. Writes expect the user locked (withTx + lockUser).
 */
import { freeCommitted } from "@constant/rules";
import { insertLedger } from "./repo.js";
import type { Q, Tx } from "./pool.js";

export async function potBalances(q: Q, userId: string): Promise<Map<string, bigint>> {
  const r = await q.query<{ pot_line_id: string; s: bigint }>(
    "SELECT pot_line_id, SUM(amount_minor)::bigint AS s FROM ledger_entries WHERE user_id = $1 AND pot_line_id IS NOT NULL GROUP BY pot_line_id",
    [userId],
  );
  return new Map(r.rows.map((x) => [x.pot_line_id, x.s]));
}

export async function potBalance(q: Q, lineId: string): Promise<bigint> {
  const r = await q.query<{ s: bigint }>("SELECT COALESCE(SUM(amount_minor), 0)::bigint AS s FROM ledger_entries WHERE pot_line_id = $1", [lineId]);
  return r.rows[0]!.s;
}

export async function freeBalance(q: Q, userId: string): Promise<bigint> {
  const r = await q.query<{ s: bigint }>("SELECT COALESCE(SUM(amount_minor), 0)::bigint AS s FROM ledger_entries WHERE user_id = $1 AND pot_line_id IS NULL", [userId]);
  return r.rows[0]!.s;
}

/**
 * Free money spoken for by open orders that haven't written their ledger entries yet: what each one's own pot can't
 * cover. Orders paid from stablecoins bring their own naira and take nothing from pots or free money here.
 */
export async function freeCommittedToOpenOrders(q: Q, userId: string): Promise<bigint> {
  const r = await q.query<{ need: bigint; pot: bigint; funding: string }>(
    `SELECT o.amount_minor + o.fee_minor AS need, o.funding,
            COALESCE((SELECT SUM(l.amount_minor) FROM ledger_entries l WHERE l.pot_line_id = o.line_id), 0)::bigint AS pot
     FROM orders o
     WHERE o.user_id = $1 AND o.state IN ('ready','vending','token_stored','notifying','needs_human')
       AND NOT EXISTS (SELECT 1 FROM ledger_entries l WHERE l.idempotency_key = 'ledger:vend:' || o.id::text)`,
    [userId],
  );
  return freeCommitted(r.rows.map((x) => ({ needMinor: x.need, potMinor: x.funding === "stables" ? 0n : x.pot })));
}

/** Moves money between free and a bill's pot: positive into the pot, negative back out. Once per key. */
export async function movePot(tx: Tx, m: { userId: string; lineId: string; amountMinor: bigint; currency: string; key: string; actor: string }): Promise<boolean> {
  if (m.amountMinor === 0n) return false;
  const a = await insertLedger(tx, { userId: m.userId, lineId: m.lineId, kind: "pot", amountMinor: -m.amountMinor, currency: m.currency, idempotencyKey: `${m.key}:free`, actor: m.actor });
  if (!a) return false;
  await insertLedger(tx, { userId: m.userId, lineId: m.lineId, potLineId: m.lineId, kind: "pot", amountMinor: m.amountMinor, currency: m.currency, idempotencyKey: `${m.key}:pot`, actor: m.actor });
  return true;
}

/** A bill is removed: whatever is left in its pot goes back to free money. */
export async function emptyPot(tx: Tx, userId: string, lineId: string, currency: string, actor: string): Promise<bigint> {
  const left = await potBalance(tx, lineId);
  if (left > 0n) await movePot(tx, { userId, lineId, amountMinor: -left, currency, key: `ledger:pot:empty:${lineId}`, actor });
  return left;
}
