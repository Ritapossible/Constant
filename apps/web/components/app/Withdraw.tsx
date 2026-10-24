"use client";

import { useCallback, useEffect, useId, useState, type FormEvent } from "react";
import { CARD_HOLD_DAYS } from "@constant/rules";
import { formatMoney } from "@/lib/app/format";
import { BankPicker, useBanks } from "./BankPicker";
import { Field } from "./Field";
import { useServer } from "./Server";
import { useNotify } from "./Toast";

type PayoutAccount = { bankName: string; last4: string; accountName: string; usableFrom: string } | null;
/** What can go out now, by the same rules the server applies to a withdrawal (kobo, as strings). */
type Available = { withdrawableMinor: string; cardHeldMinor: string; dailyRoomMinor: string; enabled: boolean };
type Withdrawal = { id: string; amountMinor: string; status: "requested" | "sent" | "succeeded" | "failed" | "reversed" | "needs_human"; createdAt: string };

const STATUS: Record<Withdrawal["status"], string> = {
  requested: "Processing",
  sent: "On its way",
  succeeded: "Paid",
  failed: "Didn't go through",
  reversed: "Returned to your balance",
  needs_human: "Being checked",
};

function toMinor(v: string): bigint | null {
  const t = v.replace(/[,\s₦]/g, "");
  if (!/^\d{1,9}$/.test(t) || BigInt(t) === 0n) return null;
  return BigInt(t) * 100n;
}

/** The line under the amount: what can go now, and why some of the balance can't yet. */
function availableText(a: Available | null): string {
  if (!a) return "Money in bill pots stays for its bill.";
  if (!a.enabled) return "Withdrawals are paused right now. Your money is safe.";
  const held = BigInt(a.cardHeldMinor);
  const now = `${formatMoney(BigInt(a.withdrawableMinor), "NGN")} can be withdrawn now.`;
  return held > 0n ? `${now} ${formatMoney(held, "NGN")} added by card can be withdrawn ${CARD_HOLD_DAYS} days after it was added.` : `${now} Money in bill pots stays for its bill.`;
}

const when = (iso: string) => new Date(iso).toLocaleString("en-NG", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

/**
 * Withdrawals to the user's own bank account (D-067, D-086): verified users only, to an account in their own name,
 * usable 24 hours after it's added. The bank is picked the same way as when verifying: type a few letters.
 */
export function Withdraw() {
  const { me, call, reload } = useServer();
  const notify = useNotify();
  const id = useId();
  const verified = (me?.user.kycTier ?? 0) >= 1;
  const banks = useBanks(verified);
  const [payout, setPayout] = useState<PayoutAccount | undefined>(undefined);
  const [history, setHistory] = useState<Withdrawal[]>([]);
  const [available, setAvailable] = useState<Available | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [bank, setBank] = useState("");
  const [account, setAccount] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A failed load says so and offers a retry; it never pretends there's no bank account on file.
  const load = useCallback(async () => {
    try {
      const [p, w, a] = await Promise.all([
        call<PayoutAccount>("/v1/payout-account"),
        call<Withdrawal[]>("/v1/withdrawals"),
        call<Available>("/v1/withdrawals/available"),
      ]);
      setPayout(p);
      setHistory(w);
      setAvailable(a);
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
  }, [call]);

  useEffect(() => {
    if (verified) load();
  }, [verified, load]);

  async function saveAccount(e: FormEvent) {
    e.preventDefault();
    if (!bank) return setError("Type your bank and pick it from the list");
    if (!/^\d{10}$/.test(account)) return setError("Enter your 10-digit account number");
    setBusy(true);
    setError(null);
    try {
      setPayout(await call<PayoutAccount>("/v1/payout-account", { method: "PUT", body: { bankCode: bank, accountNumber: account } }));
      setEditing(false);
      setAccount("");
      notify("Bank account added");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function withdraw(e: FormEvent) {
    e.preventDefault();
    const minor = toMinor(amount);
    if (!minor) return setError("Enter an amount in naira");
    setBusy(true);
    setError(null);
    try {
      await call("/v1/withdrawals", { method: "POST", body: { amountMinor: minor.toString() } });
      setAmount("");
      notify(`Withdrawing ${formatMoney(minor, "NGN")} to your bank`);
      await Promise.all([load(), reload()]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!me) return null;

  if (banks.status === "off") {
    return (
      <section className="ap-card" aria-labelledby={`${id}-title`}>
        <div className="ap-card-head">
          <h2 id={`${id}-title`}>Withdraw</h2>
          <span className="ap-chip">Opening soon</span>
        </div>
        <p className="ap-muted">You&apos;ll be able to send your free balance to your own bank account.</p>
      </section>
    );
  }

  return (
    <section className="ap-card" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>Withdraw</h2>

      {!verified ? (
        <p className="ap-muted">Verify your identity above, then you can withdraw to a bank account in your own name.</p>
      ) : loadFailed && payout === undefined ? (
        <div className="ap-inline-state" role="alert">
          <p className="ap-muted">We couldn&apos;t load your withdrawal details.</p>
          <button className="btn btn-primary btn-sm" type="button" onClick={load}>
            Try again
          </button>
        </div>
      ) : payout === undefined ? (
        <div className="ap-inline-state" role="status">
          <span className="ap-spinner" aria-hidden="true" />
          <p className="ap-muted">Loading…</p>
        </div>
      ) : !payout || editing ? (
        <form className="ap-form" onSubmit={saveAccount} noValidate>
          <p className="ap-muted">Add the bank account to withdraw to. It must be in your own name.</p>
          <Field label="Your bank">
            {(a) => <BankPicker id={a.id} list={banks} value={bank} onChange={setBank} invalid={a["aria-invalid"]} {...(a["aria-describedby"] ? { describedBy: a["aria-describedby"] } : {})} />}
          </Field>
          <Field label="Account number" error={error}>
            {(a) => (
              <input
                {...a}
                inputMode="numeric"
                maxLength={10}
                value={account}
                onChange={(e) => setAccount(e.target.value.replace(/\D/g, ""))}
                placeholder="10 digits"
              />
            )}
          </Field>
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? "Checking the account…" : "Add bank account"}
          </button>
          {payout && (
            <button
              className="btn btn-ghost"
              type="button"
              onClick={() => {
                setEditing(false);
                setError(null);
              }}
            >
              Cancel
            </button>
          )}
          <p className="ap-fine">For your safety, a new bank account can receive withdrawals 24 hours after it&apos;s added.</p>
        </form>
      ) : (
        <>
          <div className="ap-row ap-row-flat">
            <span className="ap-row-main">
              <b>
                {payout.bankName} ••{payout.last4}
              </b>
              <small>{payout.accountName}</small>
            </span>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setEditing(true);
                setError(null);
              }}
            >
              Change
            </button>
          </div>
          {new Date(payout.usableFrom) > new Date() && <p className="ap-muted">You can withdraw to this account from {when(payout.usableFrom)}.</p>}
          <form className="ap-form" onSubmit={withdraw} noValidate>
            <div className="ap-field">
              <label htmlFor={`${id}-amount`}>Amount</label>
              <div className="ap-amount" data-invalid={Boolean(error)}>
                <span aria-hidden="true">₦</span>
                <input
                  id={`${id}-amount`}
                  inputMode="numeric"
                  value={amount}
                  onChange={(e) => {
                    setAmount(e.target.value);
                    setError(null);
                  }}
                  placeholder="0"
                  aria-invalid={Boolean(error)}
                  aria-describedby={`${id}-amount-help`}
                />
              </div>
              <span id={`${id}-amount-help`} className={error ? "ap-err" : "ap-hint"} role={error ? "alert" : undefined}>
                {error ?? availableText(available)}
              </span>
            </div>
            <button className="btn btn-primary" type="submit" disabled={busy || available?.enabled === false}>
              {busy ? "Sending…" : "Withdraw"}
            </button>
          </form>
          {history.length > 0 && (
            <ul className="ap-list ap-list-tight" aria-label="Recent withdrawals">
              {history.slice(0, 5).map((w) => (
                <li key={w.id} className="ap-row">
                  <span className="ap-row-main">
                    <b>{formatMoney(BigInt(w.amountMinor), "NGN")}</b>
                    <small>{when(w.createdAt)}</small>
                  </span>
                  <span className="ap-row-right">{STATUS[w.status]}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
