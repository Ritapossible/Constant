/**
 * Review guards that run on their own schedule (D-064):
 * - screening: every address that funded a user, and the user's own smart account, is screened before its
 *   money is used. A match freezes the user and pages a person; an outage leaves it pending (never clear).
 * - sweep: charged USDC leaves the hot spender key for the treasury, so a stolen key holds little.
 */
import { STABLES } from "@constant/chains";
import {
  addressesToScreen,
  depositsToScreen,
  freezeUser,
  insertSweep,
  markSweep,
  raiseOpsAlertOnce,
  setAddressScreening,
  setDepositScreening,
  sweepInFlight,
} from "@constant/db";
import type { Hex } from "viem";
import { GIVE_UP_AFTER_MIN, REBROADCAST_AFTER_MIN, type DollarDeps } from "./dollars.js";
import type { Deps } from "./jobs.js";

const MIN = 60_000;
const USDC_BASE = STABLES.find((s) => s.key === "base-usdc")!;

export async function screenPending(d: Deps, dd: DollarDeps): Promise<{ screened: number; flagged: number }> {
  if (!dd.screener) return { screened: 0, flagged: 0 };
  let screened = 0;
  let flagged = 0;
  const cache = new Map<string, Awaited<ReturnType<NonNullable<DollarDeps["screener"]>["screen"]>>>();
  const check = async (address: string) => {
    const key = address.toLowerCase();
    if (!cache.has(key)) cache.set(key, await dd.screener!.screen(address));
    return cache.get(key)!;
  };
  const onFlag = async (userId: string, address: string, detail: string, where: string) => {
    flagged += 1;
    await freezeUser(d.db, userId, "screening");
    await raiseOpsAlertOnce(d.db, "page", "address_flagged", `flagged:${userId}:${address.toLowerCase()}`, { userId, address, detail, where });
  };

  for (const a of await addressesToScreen(d.db)) {
    try {
      const r = await check(a.address);
      await setAddressScreening(d.db, a.address, r.result === "clear" ? "clear" : "flagged");
      if (r.result === "flagged") await onFlag(a.user_id, a.address, r.detail, "own account");
      screened += 1;
    } catch (err) {
      d.log.warn("screening unavailable", { err: (err as Error).message });
      return { screened, flagged }; // try again next pass; nothing becomes clear by failing
    }
  }
  for (const dep of await depositsToScreen(d.db)) {
    try {
      const r = await check(dep.from_address);
      await setDepositScreening(d.db, dep, r.result === "clear" ? "clear" : "flagged");
      if (r.result === "flagged") await onFlag(dep.user_id, dep.from_address, r.detail, `deposit ${dep.chain}:${dep.tx_hash}`);
      screened += 1;
    } catch (err) {
      d.log.warn("screening unavailable", { err: (err as Error).message });
      break;
    }
  }
  return { screened, flagged };
}

/** One step: settle the sweep in flight, or start one when the spender holds enough USDC. */
export async function sweepSpender(d: Deps, dd: DollarDeps): Promise<"none" | "sent" | "confirmed" | "waiting" | "failed"> {
  if (!dd.treasury) return "none";
  const now = d.now();
  const inFlight = await sweepInFlight(d.db, "base", USDC_BASE.address);
  if (inFlight) {
    const st = await dd.chain.status(inFlight.tx_hash as Hex, dd.confirmations);
    if (st === "confirmed") {
      await markSweep(d.db, inFlight.id, "confirmed");
      return "confirmed";
    }
    if (st === "reverted") {
      await markSweep(d.db, inFlight.id, "failed");
      await raiseOpsAlertOnce(d.db, "page", "sweep_failed", `sweep:${inFlight.id}`, { txHash: inFlight.tx_hash });
      return "failed";
    }
    const age = now.getTime() - inFlight.created_at.getTime();
    if (age > GIVE_UP_AFTER_MIN * MIN) await raiseOpsAlertOnce(d.db, "page", "sweep_stuck", `sweep_stuck:${inFlight.id}`, { txHash: inFlight.tx_hash });
    else if (age > REBROADCAST_AFTER_MIN * MIN && inFlight.tx_raw) await dd.chain.broadcast(inFlight.tx_raw as Hex);
    return "waiting";
  }
  const balance = await dd.chain.balanceOf(USDC_BASE.address, dd.chain.spender);
  if (balance < dd.sweepMinMicro) return "none";
  const prepared = await dd.chain.prepareTransfer(USDC_BASE.address, dd.treasury, balance);
  // Saved before sending; the partial unique index allows one sweep in flight.
  if (!(await insertSweep(d.db, { chain: "base", token: USDC_BASE.address, to: dd.treasury, amount: balance, txHash: prepared.hash, txRaw: prepared.raw }))) return "waiting";
  await dd.chain.broadcast(prepared.raw);
  d.log.info("sweep sent", { amount: balance.toString(), txHash: prepared.hash });
  return "sent";
}
