/**
 * Reconciliation (D-066; PLAN step 9). Nightly at 02:00 Lagos, or when an operator asks (POST /ops/reconcile).
 * Gathers the books, asks the partner about recent paid orders and Base about recent charges, and runs checkBooks.
 * Any mismatch switches off vending, dollar charges and payouts, and pages a person (INV-12).
 */
import { raiseOpsAlert, setFlag, withTx } from "@constant/db";
import { checkBooks, localParts, type FundingFacts, type OrderFacts } from "@constant/rules";
import type { Hex } from "viem";
import type { Deps } from "./jobs.js";

const PARTNER_CHECK_DAYS = 7;
const PARTNER_CHECK_MAX = 200;

/** The run to do now: one an operator requested, or tonight's. Null if nothing is due. */
async function claimRun(d: Deps): Promise<{ id: bigint } | null> {
  return withTx(d.db, async (tx) => {
    const asked = await tx.query<{ id: bigint }>("SELECT id FROM reconciliation_runs WHERE finished_at IS NULL ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED");
    if (asked.rows[0]) return asked.rows[0];
    const now = d.now();
    if (localParts(now, "Africa/Lagos").hour < 2) return null;
    const last = await tx.query<{ started_at: Date }>("SELECT started_at FROM reconciliation_runs WHERE actor = 'nightly' ORDER BY id DESC LIMIT 1");
    if (last.rows[0] && now.getTime() - last.rows[0].started_at.getTime() < 20 * 3_600_000) return null;
    const r = await tx.query<{ id: bigint }>("INSERT INTO reconciliation_runs (actor, started_at) VALUES ('nightly', $1) RETURNING id", [now]);
    return r.rows[0]!;
  });
}

export async function reconcileBooks(d: Deps, force = false): Promise<{ ran: boolean; ok?: boolean; mismatches?: number }> {
  const run = force ? (await d.db.query<{ id: bigint }>("INSERT INTO reconciliation_runs (actor) VALUES ('forced') RETURNING id")).rows[0]! : await claimRun(d);
  if (!run) return { ran: false };
  const now = d.now();

  const rows = await d.db.query<{
    id: string; state: string; amount_minor: bigint; fee_minor: bigint; partner_ref: string | null; updated_at: Date;
    vend: string; fee: string; charge_status: string | null; naira_minor: bigint | null; charge_fund: string; tx_hash: string | null;
  }>(
    `SELECT o.id, o.state, o.amount_minor, o.fee_minor, o.partner_ref, o.updated_at,
            COALESCE((SELECT SUM(amount_minor) FROM ledger_entries l WHERE l.order_id = o.id AND l.kind = 'vend'), 0)::text AS vend,
            COALESCE((SELECT SUM(amount_minor) FROM ledger_entries l WHERE l.order_id = o.id AND l.kind = 'fee'), 0)::text AS fee,
            c.status AS charge_status, c.naira_minor, c.tx_hash,
            COALESCE((SELECT SUM(amount_minor) FROM ledger_entries l WHERE l.idempotency_key = 'ledger:fund:charge:' || c.id::text), 0)::text AS charge_fund
     FROM orders o LEFT JOIN charges c ON c.order_id = o.id
     WHERE o.created_at > $1::timestamptz - interval '35 days'`,
    [now],
  );

  const recent = now.getTime() - PARTNER_CHECK_DAYS * 86_400_000;
  let partnerChecks = 0;
  let chainChecks = 0;
  const orders: OrderFacts[] = [];
  for (const r of rows.rows) {
    const o: OrderFacts = { id: r.id, state: r.state, amountMinor: r.amount_minor, feeMinor: r.fee_minor, vendLedgerMinor: BigInt(r.vend), feeLedgerMinor: BigInt(r.fee) };
    const paid = r.state === "settled" || r.state === "notifying" || r.state === "token_stored";
    if (paid && r.partner_ref && r.updated_at.getTime() > recent && partnerChecks < PARTNER_CHECK_MAX) {
      partnerChecks += 1;
      const out = await d.vending.requery(r.partner_ref).catch(() => ({ kind: "unknown" as const }));
      o.partner = out.kind;
    }
    if (r.charge_status) {
      o.charge = { status: r.charge_status as "confirmed", nairaMinor: r.naira_minor ?? 0n, fundLedgerMinor: BigInt(r.charge_fund) };
      if (r.charge_status === "confirmed" && r.tx_hash && d.dollars && r.updated_at.getTime() > recent) {
        chainChecks += 1;
        o.charge.chain = await d.dollars.chain.status(r.tx_hash as Hex, 1n).catch(() => "unknown" as const);
      }
    }
    orders.push(o);
  }

  const fund = await d.db.query<{ provider_event_id: string; status: string; amount_minor: bigint; ledger: string }>(
    `SELECT f.provider_event_id, f.status, f.amount_minor,
            COALESCE((SELECT SUM(amount_minor) FROM ledger_entries l WHERE l.idempotency_key = 'ledger:fund:' || f.provider || ':' || f.provider_event_id), 0)::text AS ledger
     FROM funding_events f WHERE f.received_at > $1::timestamptz - interval '35 days'`,
    [now],
  );
  const funding: FundingFacts[] = fund.rows.map((f) => ({ eventId: f.provider_event_id, credited: f.status === "credited", amountMinor: f.amount_minor, ledgerMinor: BigInt(f.ledger) }));

  const result = checkBooks(orders, funding);
  const json = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x));
  await d.db.query("UPDATE reconciliation_runs SET finished_at = $2, ok = $3, checked = $4, mismatches = $5 WHERE id = $1", [
    run.id,
    d.now(),
    result.ok,
    json({ orders: orders.length, funding: funding.length, partnerChecks, chainChecks }),
    json(result.mismatches),
  ]);
  if (!result.ok) {
    for (const key of ["vending_enabled", "dollar_charges_enabled", "payouts_enabled"]) await setFlag(d.db, key, false, "reconciliation", `run ${run.id}: ${result.mismatches.length} mismatch(es)`);
    await raiseOpsAlert(d.db, "page", "reconciliation_mismatch", { run: run.id.toString(), count: result.mismatches.length, first: JSON.parse(json(result.mismatches.slice(0, 20))) });
  }
  d.log.info("reconciliation", { run: run.id.toString(), ok: result.ok, mismatches: result.mismatches.length, partnerChecks, chainChecks });
  return { ran: true, ok: result.ok, mismatches: result.mismatches.length };
}
