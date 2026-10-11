/**
 * Moving Constant's charged USDC from Arc to Base (D-070), so the off-ramp and the treasury sweep see it. Only the
 * spender's own balance, minted to the spender's own address on Base; never user money.
 *
 *   none ──balance ≥ minimum──▶ burning (approve + burn signed and saved, then sent) ──burn confirmed──▶ attesting
 *        ──Circle attests──▶ minting (mint saved, then sent on Base) ──confirmed──▶ done
 *
 * A reverted approve or burn means nothing left Arc: failed, and a person is told. A mint that reverts usually means
 * someone else already relayed it (anyone may): a person checks. One transfer in flight at a time.
 */
import { bridgeInFlight, insertBridge, raiseOpsAlertOnce, updateBridge } from "@constant/db";
import type { Hex } from "viem";
import { GIVE_UP_AFTER_MIN, REBROADCAST_AFTER_MIN, type DollarDeps } from "./dollars.js";
import type { Deps } from "./jobs.js";

const MIN = 60_000;
/** USDC left on Arc for gas (Arc's gas token is USDC itself): $1. */
export const ARC_GAS_RESERVE_MICRO = 1_000_000n;

export type BridgeStep = "off" | "none" | "too_small" | "fee_too_high" | "started" | "burning" | "attesting" | "minting" | "done" | "failed";

export async function bridgeStep(d: Deps, dd: DollarDeps): Promise<BridgeStep> {
  const arc = dd.arc;
  if (!arc) return "off";
  const { bridge } = arc;
  const now = d.now();
  const cur = await bridgeInFlight(d.db);

  if (cur) {
    const age = now.getTime() - cur.updated_at.getTime();
    switch (cur.status) {
      case "burning": {
        const [approve, burn] = await Promise.all([
          bridge.status(bridge.from, cur.approve_hash as Hex, arc.confirmations),
          bridge.status(bridge.from, cur.burn_hash as Hex, arc.confirmations),
        ]);
        if (burn === "confirmed") {
          await updateBridge(d.db, cur.id, { status: "attesting", approve_raw: null, burn_raw: null });
          return "attesting";
        }
        if (approve === "reverted" || burn === "reverted") {
          await updateBridge(d.db, cur.id, { status: "failed", error: `${approve === "reverted" ? "approve" : "burn"} reverted; nothing left Arc`, approve_raw: null, burn_raw: null });
          await raiseOpsAlertOnce(d.db, "warn", "bridge_failed", `bridge:${cur.id}`, { id: cur.id, burnHash: cur.burn_hash });
          return "failed";
        }
        if (age > GIVE_UP_AFTER_MIN * MIN) {
          await raiseOpsAlertOnce(d.db, "page", "bridge_stuck", `bridge_stuck:${cur.id}`, { id: cur.id, step: "burn", burnHash: cur.burn_hash });
        } else if (age > REBROADCAST_AFTER_MIN * MIN) {
          // Same bytes, same order: the approve's nonce comes first.
          if (cur.approve_raw) await bridge.broadcast(bridge.from, cur.approve_raw as Hex);
          if (cur.burn_raw) await bridge.broadcast(bridge.from, cur.burn_raw as Hex);
        }
        return "burning";
      }
      case "attesting": {
        const a = await bridge.attestation(cur.burn_hash as Hex).catch(() => ({ status: "pending" as const }));
        if (a.status !== "complete") {
          if (age > 2 * 60 * MIN) await raiseOpsAlertOnce(d.db, "page", "bridge_stuck", `bridge_attest:${cur.id}`, { id: cur.id, step: "attestation", burnHash: cur.burn_hash });
          return "attesting";
        }
        const mint = await bridge.prepareMint(a.message, a.attestation);
        // Saved before it is sent.
        await updateBridge(d.db, cur.id, { status: "minting", message: a.message, attestation: a.attestation, mint_hash: mint.hash, mint_raw: mint.raw });
        await bridge.broadcast(bridge.to, mint.raw);
        return "minting";
      }
      case "minting": {
        const st = await bridge.status(bridge.to, cur.mint_hash as Hex, dd.confirmations);
        if (st === "confirmed") {
          await updateBridge(d.db, cur.id, { status: "done", mint_raw: null });
          d.log.info("bridge done", { id: cur.id, amountMicro: cur.amount_micro });
          return "done";
        }
        if (st === "reverted") {
          await updateBridge(d.db, cur.id, { status: "failed", error: "mint reverted: check whether the message was already received on Base", mint_raw: null });
          await raiseOpsAlertOnce(d.db, "page", "bridge_mint_reverted", `bridge_mint:${cur.id}`, { id: cur.id, burnHash: cur.burn_hash, mintHash: cur.mint_hash });
          return "failed";
        }
        if (age > GIVE_UP_AFTER_MIN * MIN) await raiseOpsAlertOnce(d.db, "page", "bridge_stuck", `bridge_mint_stuck:${cur.id}`, { id: cur.id, step: "mint", mintHash: cur.mint_hash });
        else if (age > REBROADCAST_AFTER_MIN * MIN && cur.mint_raw) await bridge.broadcast(bridge.to, cur.mint_raw as Hex);
        return "minting";
      }
      default:
        return cur.status;
    }
  }

  const balance = await bridge.balance();
  const amount = ((balance - ARC_GAS_RESERVE_MICRO) / 10_000n) * 10_000n; // whole cents, gas kept back
  if (amount < arc.bridgeMinMicro || amount <= 0n) return "too_small";
  const fee = await bridge.fee(amount);
  if (fee * 10_000n > amount * arc.bridgeMaxFeeBps) {
    await raiseOpsAlertOnce(d.db, "warn", "bridge_fee_high", `bridge_fee:${now.toISOString().slice(0, 10)}`, { amountMicro: amount.toString(), feeMicro: fee.toString() });
    return "fee_too_high";
  }
  const { approve, burn } = await bridge.prepareBurn(amount, fee);
  const row = await insertBridge(d.db, {
    from: bridge.from,
    to: bridge.to,
    amountMicro: amount,
    maxFeeMicro: fee,
    approveHash: approve.hash,
    approveRaw: approve.raw,
    burnHash: burn.hash,
    burnRaw: burn.raw,
  });
  if (!row) return "none";
  await bridge.broadcast(bridge.from, approve.raw);
  await bridge.broadcast(bridge.from, burn.raw);
  d.log.info("bridge started", { id: row.id, amountMicro: amount.toString() });
  return "started";
}
