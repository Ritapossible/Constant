/** Transfers of Constant's own charged USDC between chains (D-070). Each transaction is saved before it is sent. */
import type { Q } from "./pool.js";

export type BridgeStatus = "burning" | "attesting" | "minting" | "done" | "failed";

export interface BridgeRow {
  id: string;
  from_chain: string;
  to_chain: string;
  amount_micro: string;
  max_fee_micro: string;
  status: BridgeStatus;
  approve_hash: string;
  approve_raw: string | null;
  burn_hash: string;
  burn_raw: string | null;
  message: string | null;
  attestation: string | null;
  mint_hash: string | null;
  mint_raw: string | null;
  error: string | null;
  created_at: Date;
  updated_at: Date;
}

/** Saves a transfer with both signed transactions. False if one is already in flight. */
export async function insertBridge(
  q: Q,
  b: { from: string; to: string; amountMicro: bigint; maxFeeMicro: bigint; approveHash: string; approveRaw: string; burnHash: string; burnRaw: string },
): Promise<BridgeRow | null> {
  try {
    const r = await q.query<BridgeRow>(
      `INSERT INTO bridges (from_chain, to_chain, amount_micro, max_fee_micro, status, approve_hash, approve_raw, burn_hash, burn_raw)
       VALUES ($1,$2,$3,$4,'burning',$5,$6,$7,$8) RETURNING *`,
      [b.from, b.to, b.amountMicro.toString(), b.maxFeeMicro.toString(), b.approveHash, b.approveRaw, b.burnHash, b.burnRaw],
    );
    return r.rows[0]!;
  } catch (err) {
    if ((err as { code?: string }).code === "23505") return null;
    throw err;
  }
}

export async function bridgeInFlight(q: Q): Promise<BridgeRow | null> {
  return (await q.query<BridgeRow>("SELECT * FROM bridges WHERE status IN ('burning','attesting','minting') LIMIT 1")).rows[0] ?? null;
}

export async function updateBridge(
  q: Q,
  id: string,
  patch: Partial<Pick<BridgeRow, "status" | "approve_raw" | "burn_raw" | "message" | "attestation" | "mint_hash" | "mint_raw" | "error">>,
): Promise<void> {
  const keys = Object.keys(patch) as (keyof typeof patch)[];
  if (!keys.length) return;
  const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(", ");
  await q.query(`UPDATE bridges SET ${sets}, updated_at = now() WHERE id = $1`, [id, ...keys.map((k) => patch[k])]);
}
