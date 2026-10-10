/**
 * Sends requested withdrawals (D-067). The reference is saved with the request; the transfer is idempotent by it,
 * so a crash or timeout is resolved by asking, and if the provider never saw it, by sending the same reference again.
 * Money held for a withdrawal is given back only on a definite failure.
 */
import {
  claimableWithdrawals,
  flag,
  getPayoutAccount,
  lockWithdrawal,
  queueNotice,
  raiseOpsAlertOnce,
  refundWithdrawal,
  updateWithdrawal,
  withTx,
  type WithdrawalRow,
} from "@constant/db";
import type { Payouts, TransferOutcome } from "@constant/partners";
import type { Deps } from "./jobs.js";

const MIN = 60_000;
/** Recheck after 2, 5, 15, 30, 60 minutes, then hourly; a person after a day. */
const BACKOFF_MIN = [2, 5, 15, 30, 60];
const GIVE_UP_CHECKS = 30;

export async function processWithdrawals(d: Deps, payouts: Payouts | undefined): Promise<number> {
  if (!payouts) return 0;
  let n = 0;
  for (const id of await claimableWithdrawals(d.db, d.now())) {
    try {
      await stepWithdrawal(d, payouts, id);
      n += 1;
    } catch (err) {
      d.log.error("withdrawal step failed", { withdrawalId: id, err: (err as Error).message });
    }
  }
  return n;
}

async function stepWithdrawal(d: Deps, payouts: Payouts, id: string) {
  const now = d.now();
  const w = await withTx(d.db, async (tx) => {
    const row = await lockWithdrawal(tx, id);
    if (!row) return null;
    if (row.status === "requested") {
      if (!(await flag(tx, "payouts_enabled"))) {
        await updateWithdrawal(tx, id, { next_check_at: new Date(now.getTime() + 10 * MIN) }); // held, not refunded
        return null;
      }
      // Marked sent before the call: a crash after this is resolved by verifying the reference.
      await updateWithdrawal(tx, id, { status: "sent", checks: 0, next_check_at: new Date(now.getTime() + BACKOFF_MIN[0]! * MIN) });
      return { ...row, call: "transfer" as const };
    }
    return row.status === "sent" ? { ...row, call: "verify" as const } : null;
  });
  if (!w) return;

  let out: TransferOutcome;
  if (w.call === "transfer") {
    out = await payouts.transfer({ reference: w.reference, recipientCode: w.recipient_code, amountMinor: w.amount_minor, reason: "Constant withdrawal" }).catch((err: Error) => ({ kind: "unknown" as const, detail: err.message }));
  } else {
    out = await payouts.verifyTransfer(w.reference);
    // Never reached the provider: send the same reference again (it can't pay twice).
    if (out.kind === "not_found" && w.checks >= 2) out = await payouts.transfer({ reference: w.reference, recipientCode: w.recipient_code, amountMinor: w.amount_minor, reason: "Constant withdrawal" }).catch((err: Error) => ({ kind: "unknown" as const, detail: err.message }));
  }
  await apply(d, w, out);
}

async function apply(d: Deps, w0: WithdrawalRow, out: TransferOutcome) {
  const now = d.now();
  await withTx(d.db, async (tx) => {
    const w = (await lockWithdrawal(tx, w0.id))!;
    if (w.status !== "sent") return; // the webhook got here first
    switch (out.kind) {
      case "succeeded": {
        await updateWithdrawal(tx, w.id, { status: "succeeded", transfer_code: out.transferCode ?? w.transfer_code });
        const acct = await getPayoutAccount(tx, w.user_id);
        await queueNotice(tx, { key: `notice:withdrawal_sent:${w.id}`, userId: w.user_id, kind: "withdrawal_sent", params: { amountMinor: w.amount_minor.toString(), bank: acct?.bank_name, last4: acct?.account_last4 } });
        return;
      }
      case "failed":
        await updateWithdrawal(tx, w.id, { status: "failed", error: out.detail });
        await refundWithdrawal(tx, w, "paystack:failed");
        await queueNotice(tx, { key: `notice:withdrawal_failed:${w.id}`, userId: w.user_id, kind: "withdrawal_failed", params: { amountMinor: w.amount_minor.toString() } });
        return;
      case "needs_otp":
        await updateWithdrawal(tx, w.id, { status: "needs_human", error: "Paystack asked for an OTP: turn off OTP for transfers" });
        await raiseOpsAlertOnce(tx, "page", "withdrawal_otp", `otp:${w.id}`, { withdrawalId: w.id });
        return;
      default: {
        const checks = w.checks + 1;
        if (checks >= GIVE_UP_CHECKS) {
          await updateWithdrawal(tx, w.id, { status: "needs_human", checks, error: "no final answer after a day" });
          await raiseOpsAlertOnce(tx, "page", "withdrawal_unclear", `unclear:${w.id}`, { withdrawalId: w.id, reference: w.reference });
          return;
        }
        const wait = BACKOFF_MIN[checks] ?? 60;
        await updateWithdrawal(tx, w.id, { checks, transfer_code: out.kind === "sent" ? (out.transferCode ?? w.transfer_code) : w.transfer_code, next_check_at: new Date(now.getTime() + wait * MIN) });
      }
    }
  });
}
