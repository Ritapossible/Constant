/** Off-ramp orders (D-068): charged USDC → naira into the vend partner's funding account. One in flight at a time. */
import type { Q } from "./pool.js";

export type OfframpRowStatus = "creating" | "created" | "funding" | "funded" | "settled" | "refunded" | "expired" | "failed";

export interface OfframpRow {
  id: string;
  provider: string;
  provider_order: string | null;
  reference: string;
  amount_micro: string;
  send_micro: string | null;
  rate: string | null;
  receive_address: string | null;
  valid_until: Date | null;
  status: OfframpRowStatus;
  tx_hash: string | null;
  tx_raw: string | null;
  error: string | null;
  created_at: Date;
  updated_at: Date;
}

export async function offrampInFlight(q: Q): Promise<OfframpRow | null> {
  return (await q.query<OfframpRow>("SELECT * FROM offramps WHERE status IN ('creating','created','funding','funded') LIMIT 1")).rows[0] ?? null;
}

/** Saved before the provider is called. False if another is already in flight. */
export async function insertOfframp(q: Q, o: { provider: string; reference: string; amountMicro: bigint; rate: string }): Promise<boolean> {
  try {
    await q.query("INSERT INTO offramps (provider, reference, amount_micro, rate, status) VALUES ($1,$2,$3,$4,'creating')", [o.provider, o.reference, o.amountMicro.toString(), o.rate]);
    return true;
  } catch (err) {
    if ((err as { code?: string }).code === "23505") return false;
    throw err;
  }
}

export async function updateOfframp(
  q: Q,
  ref: { reference: string } | { providerOrder: string },
  patch: Partial<{ status: OfframpRowStatus; provider_order: string; send_micro: string; receive_address: string; valid_until: Date | null; tx_hash: string; tx_raw: string | null; error: string | null }>,
): Promise<number> {
  const keys = Object.keys(patch) as (keyof typeof patch)[];
  const sets = [...keys.map((k, i) => `${k} = $${i + 2}`), "updated_at = now()"].join(", ");
  const where = "reference" in ref ? "reference = $1" : "provider_order = $1";
  const r = await q.query(`UPDATE offramps SET ${sets} WHERE ${where}`, ["reference" in ref ? ref.reference : ref.providerOrder, ...keys.map((k) => patch[k])]);
  return r.rowCount ?? 0;
}
