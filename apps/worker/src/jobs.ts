/**
 * The worker's jobs. Each is one pass that the main loop runs on a timer and tests call directly.
 *
 * Money rules (CLAUDE.md): rules decide, the order row is persisted before every partner call, only a
 * "delivered" from the partner settles, anything unclear is asked again and then handed to a person.
 */
import { render, type NoticeKind } from "@constant/copy";
import {
  committedToOpenOrders,
  claimNotice,
  claimableOrderIds,
  dueLineIds,
  feeFor,
  getLine,
  getMarket,
  getOrder,
  getUser,
  hasOpenOrder,
  insertOrder,
  ledgerSum,
  lockLine,
  lockOrder,
  lockUser,
  markNotice,
  ordersInState,
  queueNotice,
  raiseOpsAlert,
  receiptId,
  setVendingEnabled,
  touchOrder,
  transition,
  updateLine,
  vendingEnabled,
  withTx,
  writeVendEntries,
  type Db,
  type LineRow,
  type OrderRow,
  type Secrets,
  type Tx,
} from "@constant/db";
import type { CableProvider, CableVending, Messaging, VendOutcome } from "@constant/partners";
import {
  availableBalance,
  decideRenewal,
  nextDueAfter,
  noticeKey,
  recoverVending,
  renewalAction,
  renewalOrderKey,
  renewalRunAt,
  type RenewalQuote,
} from "@constant/rules";
import { awaitingCharge, chargeStep, renewDollarLine, type DollarDeps } from "./dollars.js";
import type { Log } from "./log.js";

export interface Deps {
  db: Db;
  vending: CableVending;
  messaging: Messaging;
  secrets: Secrets;
  log: Log;
  now: () => Date;
  /** Phone number sent to the partner when the user has none (VTpass requires one). */
  fallbackPhone: string;
  /** Dollar autopay on Base (D-063). Absent: dollar-funded lines and orders wait, nothing is charged or vended. */
  dollars?: DollarDeps;
}

const MIN = 60_000;
/** Requery after 1, 2, 5, 10, 20, 30 minutes; still unclear after that → a person (INV-8). */
export const CHECK_BACKOFF_MIN = [1, 2, 5, 10, 20, 30];
/** "Never heard of it" is only trusted after this many rechecks: the call may still have been in flight. */
export const NOT_FOUND_AFTER_CHECKS = 3;
/** After a failed renewal, try again this much later; after this many failures in a cycle, pause the line. */
export const RETRY_AFTER_FAILURE_MIN = 120;
export const MAX_FAILURES_PER_CYCLE = 3;
/** Insufficient money or a price above the cap: look again this often, so money added later still renews. */
export const RECHECK_HOLD_MIN = 60;
export const MAX_NOTICE_ATTEMPTS = 5;

const iso = (d: Date | null) => (d ? d.toISOString() : undefined);
const label = (l: LineRow) => l.nickname;

// ── Renewal scan ─────────────────────────────────────────────────────────────

/** One pass over due cable lines. Returns how many orders it created. */
export async function scanRenewals(d: Deps): Promise<number> {
  if (!(await vendingEnabled(d.db))) return 0;
  let created = 0;
  for (const lineId of await dueLineIds(d.db, d.now())) {
    try {
      if (await renewLine(d, lineId)) created += 1;
    } catch (err) {
      d.log.error("renewal scan failed for line", { lineId, err: (err as Error).message });
    }
  }
  return created;
}

async function renewLine(d: Deps, lineId: string): Promise<boolean> {
  const pre = await getLine(d.db, lineId);
  if (!pre || pre.status !== "active" || !pre.next_run_at) return false;
  if (await hasOpenOrder(d.db, lineId)) return false;

  // The quote is a side-effect-free lookup, made outside any transaction.
  const smartcard = d.secrets.decrypt(pre.ref_ciphertext);
  const lookup = await d.vending.lookup(pre.provider as CableProvider, smartcard);
  const quote: RenewalQuote | null =
    lookup.ok && lookup.renewalAmountMinor !== null ? { amountMinor: lookup.renewalAmountMinor, dueAt: lookup.dueAt } : null;
  if (pre.funding === "usdc_base") return d.dollars ? renewDollarLine(d, d.dollars, pre, quote) : false;

  return withTx(d.db, async (tx) => {
    const user = await lockUser(tx, pre.user_id);
    const line = await lockLine(tx, lineId);
    if (line.status !== "active" || !line.next_run_at) return false;
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
      availableMinor: availableBalance(await ledgerSum(tx, user.id), await committedToOpenOrders(tx, user.id)),
      hasOpenOrder: await hasOpenOrder(tx, line.id),
      lastRenewedAt: line.last_renewed_at,
    };
    const decision = decideRenewal(input);
    const action = renewalAction(decision, input, market.time_zone);
    d.log.info("renewal decision", { lineId, decision: decision.kind === "renew" ? "renew" : decision.reason });

    switch (action.kind) {
      case "vend": {
        const order = await insertOrder(tx, {
          userId: user.id,
          lineId: line.id,
          amountMinor: action.amountMinor,
          feeMinor: action.feeMinor,
          currency: line.currency,
          idempotencyKey: renewalOrderKey(line.id, line.next_run_at),
          scheduledFor: line.next_run_at,
          partner: d.vending.name,
          receiptId: receiptId(),
        });
        if (quote?.dueAt) await updateLine(tx, line.id, { due_at: quote.dueAt });
        return order !== null;
      }
      case "reschedule":
        await updateLine(tx, line.id, {
          next_run_at: action.runAt,
          ...(decision.kind === "do_not_renew" && decision.reason === "already_renewed" && quote?.dueAt ? { due_at: quote.dueAt } : {}),
        });
        return false;
      case "notify_and_hold": {
        const short = quote ? quote.amountMinor + input.feeMinor - input.availableMinor : 0n;
        await queueNotice(tx, {
          // Keyed by the subscription cycle (its end date), so hourly re-checks never repeat the message.
          key: noticeKey(line.id, action.notice, line.due_at ?? line.next_run_at),
          userId: user.id,
          lineId: line.id,
          kind: action.notice,
          params: {
            line: label(line),
            amountMinor: quote?.amountMinor.toString(),
            capMinor: line.cap_minor.toString(),
            shortMinor: short > 0n ? short.toString() : undefined,
            dueAt: iso(quote?.dueAt ?? line.due_at),
          },
        });
        // Keep this cycle's run time (and so the notice key); look again in an hour.
        await updateLine(tx, line.id, { next_run_at: new Date(Math.max(line.next_run_at.getTime(), now.getTime() + RECHECK_HOLD_MIN * MIN)) });
        return false;
      }
      case "hold":
        return false;
    }
  });
}

// ── Orders: vend and requery ─────────────────────────────────────────────────

export async function processOrders(d: Deps): Promise<void> {
  for (const id of await claimableOrderIds(d.db, d.now())) {
    try {
      // A dollar order is charged on Base first; only a confirmed charge lets it reach the vend step.
      if (await awaitingCharge(d, id)) {
        if (d.dollars) await chargeStep(d, d.dollars, id);
        continue;
      }
      await stepOrder(d, id);
    } catch (err) {
      d.log.error("order step failed", { orderId: id, err: (err as Error).message });
    }
  }
}

/** Moves one order forward by at most one partner call. */
export async function stepOrder(d: Deps, orderId: string): Promise<void> {
  const prepared = await withTx(d.db, async (tx) => {
    const order = await lockOrder(tx, orderId);
    const now = d.now();
    if (order.state === "vending") {
      if (!order.next_check_at || order.next_check_at > now) return null;
      return { call: "requery" as const, order };
    }
    if (order.state !== "ready") return null;
    if (order.funding === "usdc_base") {
      // Defence in depth: never vend a dollar order whose charge isn't confirmed (INV-45).
      const charge = await tx.query<{ status: string }>("SELECT status FROM charges WHERE order_id = $1", [order.id]);
      if (charge.rows[0]?.status !== "confirmed") return null;
    }

    const line = await lockLine(tx, order.line_id);
    const user = await getUser(tx, order.user_id);
    if (line.status !== "active" || user?.status !== "active") {
      await transition(tx, order, { type: "rejected" }, { error: `line ${line.status}`, next_check_at: null }, "worker");
      return null;
    }
    if (!(await vendingEnabled(tx))) {
      await touchOrder(tx, order.id, { next_check_at: new Date(now.getTime() + 5 * MIN) });
      return null;
    }
    // Persist the partner's request id BEFORE calling (rule 7). A crash after this line is recoverable.
    const requestId = d.vending.newRequestId(order.id, now);
    const started = await transition(tx, order, { type: "start" }, { partner_ref: requestId, next_check_at: new Date(now.getTime() + CHECK_BACKOFF_MIN[0]! * MIN), checks: 0 }, "worker");
    return {
      call: "renew" as const,
      order: started,
      req: {
        requestId,
        provider: line.provider as CableProvider,
        smartcard: d.secrets.decrypt(line.ref_ciphertext),
        amountMinor: order.amount_minor,
        phone: user.phone_e164 ? user.phone_e164.replace(/^\+234/, "0") : d.fallbackPhone,
      },
    };
  });
  if (!prepared) return;

  const outcome =
    prepared.call === "renew" ? await d.vending.renew(prepared.req) : await d.vending.requery(prepared.order.partner_ref!);
  d.log.info("partner outcome", { orderId, call: prepared.call, outcome: outcome.kind });
  await applyOutcome(d, orderId, outcome, prepared.call);
}

/** Applies what the partner said. Safe to call twice (webhook nudge and requery racing). */
export async function applyOutcome(d: Deps, orderId: string, outcome: VendOutcome, source: "renew" | "requery"): Promise<void> {
  await withTx(d.db, async (tx) => {
    const order = await lockOrder(tx, orderId);
    if (order.state !== "vending") return; // already settled, failed or with a person
    const now = d.now();
    const line = await lockLine(tx, order.line_id);
    const market = await getMarket(tx, (await getUser(tx, order.user_id))!.market_code);

    switch (outcome.kind) {
      case "delivered":
        return settleDelivered(tx, order, line, outcome.partnerTxnId, market.time_zone, now);

      case "failed":
        if (outcome.code === "018") {
          // Our float at the partner is empty. Not the user's fault: stop all vending and page a person.
          await setVendingEnabled(tx, false, "worker", "partner balance low (018)");
          await raiseOpsAlert(tx, "page", "partner_balance_low", { orderId: order.id });
        }
        return fail(tx, order, line, `${outcome.code} ${outcome.detail}`, now, outcome.code !== "018");

      case "reversed":
        // Reversed before we wrote anything: no money left the user.
        return fail(tx, order, line, `reversed: ${outcome.detail}`, now, true);

      case "not_found": {
        // Only after several rechecks (1 + 2 + 5 minutes) is "never received" trusted: the call may have been in flight.
        if (source === "requery" && order.checks >= NOT_FOUND_AFTER_CHECKS) {
          return fail(tx, order, line, "partner never received the request", now, false);
        }
        return recheckLater(tx, order, line, now, "not found yet");
      }

      case "pending":
      case "unknown":
        return recheckLater(tx, order, line, now, outcome.detail);
    }
  });
}

async function settleDelivered(tx: Tx, order: OrderRow, line: LineRow, txnId: string | null, timeZone: string, now: Date) {
  // The vend (and fee) entries are written once, here, at delivery (INV-13).
  await writeVendEntries(tx, order, order.partner_ref!);
  const stored = await transition(tx, order, { type: "token" }, { ...(txnId ? { partner_txn_id: txnId } : {}), next_check_at: null, error: null }, "worker");
  await transition(tx, stored, { type: "notify_start" }, {}, "worker");
  const due = nextDueAfter(line.due_at ?? order.scheduled_for ?? now, timeZone);
  await updateLine(tx, line.id, { last_renewed_at: now, due_at: due, next_run_at: renewalRunAt(due, timeZone) });
  await queueNotice(tx, {
    key: `notice:renewed:${order.id}`,
    userId: order.user_id,
    lineId: line.id,
    orderId: order.id,
    kind: "renewed",
    params: { line: label(line), amountMinor: order.amount_minor.toString(), dueAt: due.toISOString() },
  });
}

async function fail(tx: Tx, order: OrderRow, line: LineRow, error: string, now: Date, tellUser: boolean) {
  await transition(tx, order, { type: "rejected" }, { error, next_check_at: null }, "worker");
  const failures = await tx.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM orders WHERE line_id = $1 AND state = 'failed' AND created_at > COALESCE($2, '-infinity'::timestamptz)",
    [line.id, line.last_renewed_at],
  );
  if ((failures.rows[0]?.n ?? 0) >= MAX_FAILURES_PER_CYCLE) {
    await updateLine(tx, line.id, { status: "frozen", frozen_reason: `renewal failed ${MAX_FAILURES_PER_CYCLE} times` });
    await raiseOpsAlert(tx, "page", "renewal_failing", { lineId: line.id, lastError: error });
  } else {
    await updateLine(tx, line.id, { next_run_at: new Date(now.getTime() + RETRY_AFTER_FAILURE_MIN * MIN) });
  }
  if (tellUser) {
    await queueNotice(tx, {
      key: noticeKey(line.id, "renewal_failed", line.due_at ?? order.scheduled_for ?? now),
      userId: order.user_id,
      lineId: line.id,
      orderId: order.id,
      kind: "renewal_failed",
      params: { line: label(line) },
    });
  }
}

async function recheckLater(tx: Tx, order: OrderRow, line: LineRow, now: Date, detail: string) {
  const wait = CHECK_BACKOFF_MIN[order.checks];
  const checks = order.checks + 1;
  if (wait === undefined) {
    // Still unclear after every recheck: a person decides. Freeze this line only (INV-8).
    await transition(tx, order, { type: "ambiguous" }, { checks, next_check_at: null, error: detail }, "worker");
    await updateLine(tx, line.id, { status: "frozen", frozen_reason: "payment needs a person to confirm" });
    await raiseOpsAlert(tx, "page", "order_needs_human", { orderId: order.id, partnerRef: order.partner_ref, detail });
    await queueNotice(tx, { key: `notice:needs_attention:${order.id}`, userId: order.user_id, lineId: line.id, orderId: order.id, kind: "needs_attention", params: { line: label(line) } });
    return;
  }
  await touchOrder(tx, order.id, { checks, next_check_at: new Date(now.getTime() + wait * MIN), error: detail });
}


// ── Recovery ─────────────────────────────────────────────────────────────────

/** On start: every order caught in `vending` is asked about, never re-sent (INV-8). */
export async function recover(d: Deps): Promise<void> {
  for (const order of await ordersInState(d.db, "vending")) {
    const action = recoverVending(order.partner_ref);
    if (action.kind === "fetch") {
      await touchOrder(d.db, order.id, { next_check_at: d.now() });
      continue;
    }
    await withTx(d.db, async (tx) => {
      const o = await lockOrder(tx, order.id);
      if (o.state !== "vending") return;
      await transition(tx, o, { type: "ambiguous" }, { error: "no partner reference after restart", next_check_at: null }, "worker");
      await updateLine(tx, o.line_id, { status: "frozen", frozen_reason: "payment needs a person to confirm" });
      await raiseOpsAlert(tx, "page", "order_needs_human", { orderId: o.id, reason: "no partner_ref" });
    });
  }
  for (const order of await ordersInState(d.db, "token_stored")) {
    await withTx(d.db, async (tx) => {
      const o = await lockOrder(tx, order.id);
      if (o.state === "token_stored") await transition(tx, o, { type: "notify_start" }, {}, "worker");
    });
  }
}

// ── Notices ──────────────────────────────────────────────────────────────────

/** Sends pending messages. Email first, then SMS. A delivered renewal settles its order once told. */
export async function sendNotices(d: Deps, max = 20): Promise<number> {
  let sent = 0;
  for (let i = 0; i < max; i++) {
    const more = await withTx(d.db, async (tx) => {
      const n = await claimNotice(tx, d.now());
      if (!n) return false;
      const user = await getUser(tx, n.user_id);
      const target =
        user?.email && d.messaging.channels.includes("email")
          ? { channel: "email" as const, to: user.email }
          : user?.phone_e164 && d.messaging.channels.includes("sms")
            ? { channel: "sms" as const, to: user.phone_e164 }
            : null;
      const attempts = n.attempts + 1;
      let ok = false;
      if (!target) {
        await markNotice(tx, n.id, { status: "failed", attempts, error: "no channel for this user" });
      } else {
        const msg = render(n.kind as NoticeKind, n.params as Record<string, string>);
        try {
          const r = await d.messaging.send(target.channel, target.to, msg.subject, msg.text);
          await markNotice(tx, n.id, { status: "sent", attempts, channel: target.channel, provider_msg_id: r.providerId });
          ok = true;
          sent += 1;
        } catch (err) {
          const done = attempts >= MAX_NOTICE_ATTEMPTS;
          await markNotice(tx, n.id, {
            status: done ? "failed" : "pending",
            attempts,
            channel: target.channel,
            error: (err as Error).message,
            next_attempt_at: new Date(d.now().getTime() + 2 ** attempts * MIN),
          });
          if (!done) return true;
        }
      }
      // The renewal itself is delivered; a message that could not be sent must not hold the line's slot.
      if (n.order_id) {
        const o = await lockOrder(tx, n.order_id);
        if (o.state === "notifying") await transition(tx, o, { type: "notified" }, { settled_at: d.now() }, "worker", ok ? undefined : { message: "not delivered" });
      }
      return true;
    });
    if (!more) break;
  }
  return sent;
}

export { getOrder, nudgeOrder } from "@constant/db";
