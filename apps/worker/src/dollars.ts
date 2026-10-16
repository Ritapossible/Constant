/**
 * Paying naira bills from stablecoins: USDC (D-063) and USDT (D-069) on Base, USDC on Arc (D-070).
 *
 *   permission: signed ──approveWithSignature──▶ approving ──confirmed──▶ approved ──user stops──▶ revoke_pending ──▶ revoked
 *   order (stables): ready + charge pending ──spend tx saved, then sent──▶ submitted ──confirmed──▶ naira credited ──▶ normal vend
 *
 * A line may allow several tokens, one permission each; the first that can pay the whole bill pays it (USDC first).
 * The charge happens before the vend (INV-15, INV-45). The tokens received become exactly the order's naira amount in
 * the user's balance, so the vend, ledger, receipts and refunds are the naira path unchanged. If the vend then fails,
 * the naira stays in the user's balance for the next renewal.
 */
import { STABLES, permissionFromJson, stableFor, type Bridge, type EvmChain, type PermissionChain, type SpendPermission, type StableToken } from "@constant/chains";
import {
  accountScreening,
  charged24hMicro,
  flag,
  freezeUser,
  raiseOpsAlertOnce,
  setFlag,
  getMarket,
  getPermission,
  insertCharge,
  insertLedger,
  insertOrder,
  hasApprovedPermission,
  livePermissions,
  lockCharge,
  lockLine,
  lockOrder,
  lockPermission,
  lockUser,
  hasOpenOrder,
  feeFor,
  permissionsInStatus,
  queueNotice,
  raiseOpsAlert,
  receiptId,
  setLineFunding,
  touchOrder,
  transition,
  updateCharge,
  updateLine,
  updatePermission,
  vendingEnabled,
  withTx,
  type LineRow,
  type PermissionRow,
} from "@constant/db";
import type { AddressScreener, RateSource } from "@constant/partners";
import {
  decideChargeGuard,
  decideStablesRenewal,
  noticeKey,
  parseRate,
  renewalAction,
  renewalOrderKey,
  type RenewalQuote,
  type StableSource,
} from "@constant/rules";
import type { Address, Hex } from "viem";
import type { Deps } from "./jobs.js";

export interface DollarDeps {
  /** Base: charges, sweeps, the off-ramp. */
  chain: PermissionChain;
  /** Arc (D-070): charges USDC on Arc; Constant's charged USDC is moved to Base with CCTP. Absent: Arc is off. */
  arc?: ArcDeps;
  rates: RateSource;
  /** Blocks on top of a Base transaction before it counts. */
  confirmations: bigint;
  /** Sanctions screening of the account and every address that funded it (D-064). */
  screener?: AddressScreener;
  /** True in production: an unscreened account is never charged. */
  screeningRequired: boolean;
  /** Most the spender may take in 24 hours, all users together; past it, dollar charging switches itself off. */
  dailyLimitMicro: bigint;
  /** Naira that must stay at the vend partner beyond this order, for orders already in flight. */
  floatMarginMinor: bigint;
  /** Where charged USDC is swept from the hot spender key. Unset: no sweep (charges still work). */
  treasury?: Address;
  /** Sweep once the spender holds at least this much USDC (micro). */
  sweepMinMicro: bigint;
}

export interface ArcDeps {
  chain: PermissionChain;
  bridge: Bridge;
  /** Arc is final in under a second; one block is enough. */
  confirmations: bigint;
  /** Move charged USDC to Base once the spender holds at least this much on Arc (micro). */
  bridgeMinMicro: bigint;
  /** Never pay Circle more than this fee per transfer, in basis points. */
  bridgeMaxFeeBps: bigint;
}

/** The chain a permission or charge lives on, if Constant is set up for it. */
export function chainFor(dd: DollarDeps, chain: string): { chain: PermissionChain; confirmations: bigint } | null {
  if (chain === "base") return { chain: dd.chain, confirmations: dd.confirmations };
  if (chain === "arc" && dd.arc) return { chain: dd.arc.chain, confirmations: dd.arc.confirmations };
  return null;
}

const MIN = 60_000;
/** Re-send a saved transaction the network hasn't mined after this long; hand it to a person after the second. */
export const REBROADCAST_AFTER_MIN = 10;
export const GIVE_UP_AFTER_MIN = 60;

export function rowToPermission(p: PermissionRow): SpendPermission {
  return permissionFromJson({
    account: p.account,
    spender: p.spender,
    token: p.token,
    allowance: p.allowance,
    period: Number(p.period),
    start: Number(p.start_at),
    end: Number(p.end_at),
    salt: p.salt,
    extraData: p.extra_data,
  });
}

const usd = (micro: bigint) => `${micro / 1_000_000n}.${((micro % 1_000_000n) / 10_000n).toString().padStart(2, "0")}`;

// ── Renewal decision for a dollar-funded line ────────────────────────────────

/** The token a permission is for: only tokens Constant accepts, on a chain it's set up for, in the order they're tried. */
function tokenOf(p: PermissionRow, dd?: DollarDeps): StableToken | null {
  if (p.chain !== "base" && p.chain !== "arc") return null;
  if (dd && !chainFor(dd, p.chain)) return null;
  return stableFor(p.chain as EvmChain, p.token);
}
const preference = (t: StableToken) => STABLES.indexOf(t);

export async function renewDollarLine(d: Deps, dd: DollarDeps, pre: LineRow, quote: RenewalQuote | null): Promise<boolean> {
  // Everything that needs the network happens before the transaction.
  const perms = (await livePermissions(d.db, pre.id))
    .map((p) => ({ row: p, token: tokenOf(p, dd) }))
    .filter((x): x is { row: PermissionRow; token: StableToken } => x.token !== null)
    .sort((a, b) => preference(a.token) - preference(b.token));
  // The amount only picks the provider's rate tier; a rough dollar figure is enough.
  const roughUsd = quote ? Math.ceil(Number(quote.amountMinor) / 100 / 1000) : 20;
  const rates = new Map<string, { koboPerUsdc: bigint; fetchedAt: Date } | null>();
  for (const sym of new Set(perms.map((x) => x.token.symbol))) {
    try {
      // Stamped with the worker's clock: the same clock the rule compares against.
      rates.set(sym, { koboPerUsdc: parseRate((await dd.rates.toNgn(sym, roughUsd)).ngnPerUsdc), fetchedAt: d.now() });
    } catch (err) {
      d.log.warn("rate unavailable", { symbol: sym, err: (err as Error).message });
      rates.set(sym, null);
    }
  }
  const sources: (StableSource & { row: PermissionRow; token: StableToken })[] = await Promise.all(
    perms.map(async ({ row, token }) => {
      const sp = rowToPermission(row);
      const on = chainFor(dd, row.chain)!.chain;
      const [remaining, balance] = await Promise.all([on.remainingThisPeriod(sp), on.balanceOf(sp.token, sp.account)]);
      return {
        key: row.id,
        row,
        token,
        permission: { status: row.status, remainingThisPeriod: remaining, endsAt: sp.end },
        rate: rates.get(token.symbol) ?? null,
        walletMicro: balance,
      };
    }),
  );
  const walletMicro = sources.reduce((sum, x) => sum + x.walletMicro, 0n);
  // "USDC or USDT on Base", "USDC on Base or USDC on Arc": what the user can add to get the bill paid.
  const symbols =
    (["base", "arc"] as const)
      .map((c) => {
        const syms = [...new Set(sources.filter((x) => x.token.chain === c).map((x) => x.token.symbol))];
        return syms.length ? `${syms.join(" or ")} on ${c === "base" ? "Base" : "Arc"}` : null;
      })
      .filter(Boolean)
      .join(" or ") || "USDC on Base";

  return withTx(d.db, async (tx) => {
    const user = await lockUser(tx, pre.user_id);
    const line = await lockLine(tx, pre.id);
    if (line.status !== "active" || !line.next_run_at || line.funding !== "stables") return false;
    const now = d.now();
    const market = await getMarket(tx, user.market_code);
    const input = {
      vendingEnabled: await vendingEnabled(tx),
      status: user.status === "frozen" ? ("frozen" as const) : line.status,
      verified: line.verified,
      runAt: line.next_run_at,
      now,
      quote,
      capMinor: line.cap_minor,
      feeMinor: await feeFor(tx, market.code, line.kind),
      hasOpenOrder: await hasOpenOrder(tx, line.id),
      lastRenewedAt: line.last_renewed_at,
    };
    const decision = decideStablesRenewal(input, sources);
    d.log.info("dollar renewal decision", { lineId: line.id, decision: decision.kind === "charge" ? "charge" : decision.reason });
    const cycle = line.due_at ?? line.next_run_at;
    const later = new Date(Math.max(line.next_run_at.getTime(), now.getTime() + 60 * MIN));

    if (decision.kind === "charge") {
      const order = await insertOrder(tx, {
        userId: user.id,
        lineId: line.id,
        amountMinor: decision.amountMinor,
        feeMinor: decision.feeMinor,
        currency: line.currency,
        idempotencyKey: renewalOrderKey(line.id, line.next_run_at),
        scheduledFor: line.next_run_at,
        partner: d.vending.name,
        receiptId: receiptId(),
        funding: "stables",
      });
      if (!order) return false;
      const src = sources.find((x) => x.key === decision.source)!;
      await insertCharge(tx, {
        orderId: order.id,
        permissionId: src.row.id,
        chain: src.row.chain,
        token: src.token.address,
        amountMicro: decision.usdcMicro,
        koboPerUnit: decision.koboPerUsdc,
        nairaMinor: decision.amountMinor + decision.feeMinor,
      });
      if (quote?.dueAt) await updateLine(tx, line.id, { due_at: quote.dueAt });
      return true;
    }

    switch (decision.reason) {
      case "no_permission":
      case "permission_expired":
      case "allowance_used":
      case "wallet_short": {
        const kind = decision.reason === "wallet_short" ? "stables_short" : decision.reason === "allowance_used" ? "allowance_low" : "permission_needed";
        await queueNotice(tx, {
          key: noticeKey(line.id, kind, cycle),
          userId: user.id,
          lineId: line.id,
          kind,
          params: { line: line.nickname, usd: decision.usdcMicro ? usd(decision.usdcMicro) : undefined, have: usd(walletMicro), symbol: symbols },
        });
        await updateLine(tx, line.id, { next_run_at: later });
        return false;
      }
      case "rate_stale":
        return false; // try again next scan
      default: {
        // Every naira reason is handled exactly as on the naira path.
        const action = renewalAction({ kind: "do_not_renew", reason: decision.reason }, input, market.time_zone);
        if (action.kind === "reschedule") await updateLine(tx, line.id, { next_run_at: action.runAt, ...(decision.reason === "already_renewed" && quote?.dueAt ? { due_at: quote.dueAt } : {}) });
        if (action.kind === "notify_and_hold") {
          await queueNotice(tx, {
            key: noticeKey(line.id, action.notice, cycle),
            userId: user.id,
            lineId: line.id,
            kind: action.notice,
            params: { line: line.nickname, amountMinor: quote?.amountMinor.toString(), capMinor: line.cap_minor.toString(), dueAt: (quote?.dueAt ?? line.due_at)?.toISOString() },
          });
          await updateLine(tx, line.id, { next_run_at: later });
        }
        return false;
      }
    }
  });
}

// ── Charges ──────────────────────────────────────────────────────────────────

/** True if this order is a dollar order whose charge isn't confirmed yet (so it must not be vended). */
export async function awaitingCharge(d: Deps, orderId: string): Promise<boolean> {
  const r = await d.db.query<{ funding: string; state: string; status: string | null }>(
    "SELECT o.funding, o.state, c.status FROM orders o LEFT JOIN charges c ON c.order_id = o.id WHERE o.id = $1",
    [orderId],
  );
  const row = r.rows[0];
  return !!row && row.funding === "stables" && row.state === "ready" && row.status !== "confirmed";
}

/** Moves one dollar charge forward. Never vends; the normal order step does that once the charge is confirmed. */
export async function chargeStep(d: Deps, dd: DollarDeps, orderId: string): Promise<void> {
  const snap = await d.db.query<{ status: string; permission_id: string; amount_micro: string; tx_hash: string | null; tx_raw: string | null; submitted_at: Date | null }>(
    "SELECT status, permission_id, amount_micro, tx_hash, tx_raw, submitted_at FROM charges WHERE order_id = $1",
    [orderId],
  );
  const c = snap.rows[0];
  if (!c) return;
  const perm = await getPermission(d.db, c.permission_id);
  if (!perm) return;
  const sp = rowToPermission(perm);
  const now = d.now();
  const on = chainFor(dd, perm.chain);
  if (!on) return; // that chain isn't configured on this worker: nothing is charged or vended (awaitingCharge holds it)
  const { chain, confirmations } = on;

  if (c.status === "pending") {
    // Re-check on chain right before charging: the user may have spent, moved money or revoked since the scan.
    const value = BigInt(c.amount_micro);
    const [approved, remaining, balance] = await Promise.all([chain.isApproved(sp), chain.remainingThisPeriod(sp), chain.balanceOf(sp.token, sp.account)]);
    if (perm.status === "approved" && !approved) {
      // Revoked from the user's own wallet, outside Constant: record it, and leave stablecoins if nothing else is on.
      await withTx(d.db, async (tx) => {
        const locked = await lockPermission(tx, perm.id);
        if (locked.status !== "approved") return;
        await updatePermission(tx, perm.id, { status: "revoked", error: "revoked on chain outside ConstantUnits" });
        if (!(await hasApprovedPermission(tx, perm.line_id, perm.id))) await setLineFunding(tx, perm.line_id, "naira");
      });
    }
    if (perm.status !== "approved" || !approved || value > remaining || value > balance) {
      return failCharge(d, orderId, !approved || perm.status !== "approved" ? "permission not usable" : value > remaining ? "allowance used" : "not enough USDC", true);
    }

    // The review's guards: a daily limit on the spender, screened money only, and naira on hand to pay the bill.
    const naira = await d.db.query<{ naira_minor: bigint }>("SELECT naira_minor FROM charges WHERE order_id = $1", [orderId]);
    const floatMinor = await d.vending.floatBalance().catch(() => null);
    const guard = decideChargeGuard({
      dollarChargesEnabled: await flag(d.db, "dollar_charges_enabled", true),
      spent24hMicro: await charged24hMicro(d.db, now),
      valueMicro: value,
      dailyLimitMicro: dd.dailyLimitMicro,
      floatMinor,
      needMinor: naira.rows[0]!.naira_minor,
      floatMarginMinor: dd.floatMarginMinor,
      screening: dd.screener ? await accountScreening(d.db, sp.account) : "unscreened",
      screeningRequired: dd.screeningRequired,
    });
    const hour = now.toISOString().slice(0, 13);
    if (guard.kind === "stop_all") {
      if (guard.reason === "daily_limit") await setFlag(d.db, "dollar_charges_enabled", false, "worker", "daily dollar limit reached");
      await raiseOpsAlertOnce(d.db, "page", "dollar_charges_stopped", `dollar_stop:${guard.reason}:${hour}`, { reason: guard.reason });
      await touchOrder(d.db, orderId, { next_check_at: new Date(now.getTime() + 5 * MIN) });
      return;
    }
    if (guard.kind === "hold") {
      if (guard.reason !== "screening_pending") await raiseOpsAlertOnce(d.db, "page", "naira_float", `float:${guard.reason}:${hour}`, { need: naira.rows[0]!.naira_minor.toString(), float: floatMinor?.toString() ?? null });
      await touchOrder(d.db, orderId, { next_check_at: new Date(now.getTime() + 5 * MIN) });
      return;
    }
    if (guard.kind === "refuse") {
      if (guard.reason === "screening_flagged") {
        const owner = await d.db.query<{ user_id: string }>("SELECT user_id FROM orders WHERE id = $1", [orderId]);
        await freezeUser(d.db, owner.rows[0]!.user_id, "screening");
      }
      await raiseOpsAlertOnce(d.db, "page", "charge_refused", `refused:${orderId}`, { orderId, reason: guard.reason });
      // Don't explain a sanctions match to the account holder; the generic failure message is sent.
      return failCharge(d, orderId, guard.reason, true);
    }

    const prepared = await chain.prepareSpend(sp, value);
    // Save the hash before sending (rule 7): a crash after this line is recoverable by re-sending the same bytes.
    const saved = await withTx(d.db, async (tx) => {
      const locked = await lockCharge(tx, orderId);
      if (!locked || locked.status !== "pending") return false;
      await updateCharge(tx, locked.id, { status: "submitted", tx_hash: prepared.hash, tx_raw: prepared.raw, submitted_at: now });
      await touchOrder(tx, orderId, { next_check_at: new Date(now.getTime() + 15_000) });
      return true;
    });
    if (saved) await chain.broadcast(prepared.raw);
    return;
  }

  if (c.status === "submitted" && c.tx_hash) {
    const st = await chain.status(c.tx_hash as Hex, confirmations);
    if (st === "confirmed") {
      await withTx(d.db, async (tx) => {
        const locked = await lockCharge(tx, orderId);
        if (!locked || locked.status !== "submitted") return;
        const order = await lockOrder(tx, orderId);
        await lockUser(tx, order.user_id);
        await updateCharge(tx, locked.id, { status: "confirmed", confirmed_at: now, tx_raw: null });
        // The dollars arrived: credit exactly the order's naira, so the vend can spend it.
        await insertLedger(tx, {
          userId: order.user_id,
          lineId: order.line_id,
          orderId: order.id,
          kind: "fund",
          amountMinor: locked.naira_minor,
          currency: order.currency,
          idempotencyKey: `ledger:fund:charge:${locked.id}`,
          externalRef: locked.tx_hash,
          actor: "base",
        });
        await touchOrder(tx, orderId, { next_check_at: now });
      });
      return;
    }
    if (st === "reverted") return failCharge(d, orderId, "charge transaction reverted", true);
    const age = now.getTime() - (c.submitted_at?.getTime() ?? now.getTime());
    if (age > GIVE_UP_AFTER_MIN * MIN) {
      // Nobody can say whether the dollars moved: a person decides; nothing is vended meanwhile (INV-8).
      await withTx(d.db, async (tx) => {
        const order = await lockOrder(tx, orderId);
        if (order.state !== "ready") return;
        await transition(tx, order, { type: "ambiguous" }, { next_check_at: null, error: "dollar charge unconfirmed" }, "worker");
        await updateLine(tx, order.line_id, { status: "frozen", frozen_reason: "payment needs a person to confirm" });
        await raiseOpsAlert(tx, "page", "charge_unconfirmed", { orderId, txHash: c.tx_hash });
      });
      return;
    }
    if (age > REBROADCAST_AFTER_MIN * MIN && c.tx_raw) await chain.broadcast(c.tx_raw as Hex);
    await touchOrder(d.db, orderId, { next_check_at: new Date(now.getTime() + 30_000) });
  }
}

async function failCharge(d: Deps, orderId: string, reason: string, tellUser: boolean) {
  await withTx(d.db, async (tx) => {
    const order = await lockOrder(tx, orderId);
    if (order.state !== "ready") return;
    const charge = await lockCharge(tx, orderId);
    if (charge) await updateCharge(tx, charge.id, { status: "failed", error: reason, tx_raw: null });
    await transition(tx, order, { type: "rejected" }, { error: reason, next_check_at: null }, "worker");
    const line = await lockLine(tx, order.line_id);
    await updateLine(tx, line.id, { next_run_at: new Date(d.now().getTime() + 120 * MIN) });
    if (tellUser) {
      await queueNotice(tx, {
        key: noticeKey(line.id, "renewal_failed", line.due_at ?? order.scheduled_for ?? d.now()),
        userId: order.user_id,
        lineId: line.id,
        orderId: order.id,
        kind: "renewal_failed",
        params: { line: line.nickname },
      });
    }
  });
}

// ── Permissions on chain ─────────────────────────────────────────────────────

/** Registers signed permissions on chain, and revokes stopped ones, with the same save-then-send discipline. */
export async function processPermissions(d: Deps, dd: DollarDeps): Promise<void> {
  const now = d.now();
  for (const p of await permissionsInStatus(d.db, ["signed", "approving", "revoke_pending"])) {
    try {
      const sp = rowToPermission(p);
      const on = chainFor(dd, p.chain);
      if (!on) continue; // a chain this worker isn't set up for
      const { chain, confirmations } = on;
      if (p.status === "signed" || (p.status === "revoke_pending" && !p.tx_hash)) {
        const prepared = p.status === "signed" ? await chain.prepareApprove(sp, p.signature as Hex) : await chain.prepareRevoke(sp);
        const saved = await withTx(d.db, async (tx) => {
          const locked = await lockPermission(tx, p.id);
          if (locked.status !== p.status || locked.tx_hash) return false;
          await updatePermission(tx, p.id, { status: p.status === "signed" ? "approving" : "revoke_pending", tx_hash: prepared.hash, tx_raw: prepared.raw });
          return true;
        });
        if (saved) await chain.broadcast(prepared.raw);
        continue;
      }
      if (!p.tx_hash) continue;
      const st = await chain.status(p.tx_hash as Hex, confirmations);
      if (st === "confirmed" || st === "reverted") {
        await withTx(d.db, async (tx) => {
          const locked = await lockPermission(tx, p.id);
          if (locked.status === "approving") {
            await updatePermission(tx, p.id, st === "confirmed" ? { status: "approved", tx_raw: null } : { status: "failed", error: "approve reverted", tx_raw: null });
            // A failed token leaves the bill on stablecoins if another token is still on.
            if (st === "confirmed") await setLineFunding(tx, p.line_id, "stables");
            else if (!(await hasApprovedPermission(tx, p.line_id, p.id))) await setLineFunding(tx, p.line_id, "naira");
            const line = await lockLine(tx, p.line_id);
            await queueNotice(tx, {
              key: `notice:permission:${p.id}:${st}`,
              userId: p.user_id,
              lineId: p.line_id,
              kind: st === "confirmed" ? "permission_on" : "permission_failed",
              params: { line: line.nickname, usd: usd(BigInt(p.allowance)), symbol: tokenOf(p)?.symbol ?? "USDC", network: p.chain === "arc" ? "Arc" : "Base" },
            });
          } else if (locked.status === "revoke_pending") {
            // Constant stopped using it the moment the user asked; this records the on-chain revoke.
            await updatePermission(tx, p.id, { status: "revoked", tx_raw: null, error: st === "reverted" ? "revoke reverted (likely never approved)" : null });
          }
        });
        continue;
      }
      const age = now.getTime() - p.updated_at.getTime();
      if (age > GIVE_UP_AFTER_MIN * MIN) {
        await updatePermission(d.db, p.id, p.status === "approving" ? { status: "failed", error: "approve not mined", tx_raw: null } : { status: "revoked", error: "revoke not mined", tx_raw: null });
        if (p.status === "approving" && !(await hasApprovedPermission(d.db, p.line_id, p.id))) await setLineFunding(d.db, p.line_id, "naira");
        await raiseOpsAlert(d.db, "warn", "permission_tx_stuck", { permissionId: p.id, txHash: p.tx_hash });
      } else if (age > REBROADCAST_AFTER_MIN * MIN && p.tx_raw) {
        await chain.broadcast(p.tx_raw as Hex);
      }
    } catch (err) {
      d.log.error("permission step failed", { permissionId: p.id, err: (err as Error).message });
    }
  }
}

