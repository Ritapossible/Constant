"use client";

import { useCallback, useEffect, useId, useState, type FormEvent } from "react";
import { ApiError } from "@/lib/app/api";
import { formatMoney } from "@/lib/app/format";
import { BankPicker, type Bank } from "./BankPicker";
import { Field } from "./Field";
import { useServer } from "./Server";
import { useNotify } from "./Toast";

type PayoutAccount = { bankName: string; last4: string; accountName: string; usableFrom: string } | null;
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

const when = (iso: string) => new Date(iso).toLocaleString("en-NG", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

/**
 * Withdrawals to the user's own bank account (D-067, D-086): verified users only, to an account in their own name,
 * usable 24 hours after it's added. The bank is picked the same way as when verifying: type a few letters.
 */
export function Withdraw() {
  const { me, call, reload } = useServer();
  const notify = useNotify();
  const id = useId();
  const [off, setOff] = useState(false);
  const [banks, setBanks] = useState<Bank[]>([]);
  const [payout, setPayout] = useState<PayoutAccount | undefined>(undefined);
  const [history, setHistory] = useState<Withdrawal[]>([]);
  const [editing, setEditing] = useState(false);
  const [bank, setBank] = useState("");
  const [account, setAccount] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const verified = (me?.user.kycTier ?? 0) >= 1;

  const load = useCallback(async () => {
    try {
      const [p, w] = await Promise.all([call<PayoutAccount>("/v1/payout-account"), call<Withdrawal[]>("/v1/withdrawals")]);
      setPayout(p);
      setHistory(w);
    } catch {
      setPayout(null);
    }
  }, [call]);

  useEffect(() => {
    if (!verified) return;
    call<Bank[]>("/v1/banks")
      .then(setBanks)
      .catch((err) => {
        if (err instanceof ApiError && err.code === "payouts_off") setOff(true);
      });
    load();
  }, [verified, call, load]);

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

  if (off) {
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
      ) : payout === undefined ? (
        <div className="ap-inline-state" role="status">
          <span className="ap-spinner" aria-hidden="true" />
          <p className="ap-muted">Loading…</p>
        </div>
      ) : !payout || editing ? (
        <form className="ap-form" onSubmit={saveAccount} noValidate>
          <p className="ap-muted">Add the bank account to withdraw to. It must be in your own name.</p>
          <Field label="Your bank">
            {(a) => <BankPicker id={a.id} banks={banks} value={bank} onChange={setBank} invalid={a["aria-invalid"]} {...(a["aria-describedby"] ? { describedBy: a["aria-describedby"] } : {})} />}
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
                {error ?? `${formatMoney(BigInt(me.balance.freeMinor), "NGN")} free to withdraw. Money in bill pots stays for its bill.`}
              </span>
            </div>
            <button className="btn btn-primary" type="submit" disabled={busy}>
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
