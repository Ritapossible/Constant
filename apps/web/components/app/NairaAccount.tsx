"use client";

import { useState, type FormEvent } from "react";
import { formatMoney } from "@/lib/app/format";
import { Field } from "./Field";
import { useServer } from "./Server";
import { useNotify } from "./Toast";

/** The user's naira balance and their own account number for bank transfers (Paystack dedicated account). */
export function NairaAccount() {
  const { me, loading, error, call, reload } = useServer();
  const notify = useNotify();
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!first.trim() || !last.trim()) return setFormError("Enter your first and last name as they appear at your bank");
    if (!/^(\+234|0)[789]\d{9}$/.test(phone.replace(/[\s-]/g, ""))) return setFormError("Enter your Nigerian mobile number, e.g. 0803 123 4567");
    setBusy(true);
    setFormError(null);
    try {
      await call("/v1/funding-account", { method: "POST", body: { firstName: first.trim(), lastName: last.trim(), phone: phone.replace(/[\s-]/g, "") } });
      await reload();
      notify("Your account number is ready");
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!me) {
    return (
      <section className="ap-card" aria-labelledby="bank-title">
        <h2 id="bank-title">Naira</h2>
        {loading ? (
          <div className="ap-inline-state" role="status">
            <span className="ap-spinner" aria-hidden="true" />
            <p className="ap-muted">Loading your balance…</p>
          </div>
        ) : (
          <div className="ap-inline-state" role="alert">
            <p className="ap-muted">{error ?? "Couldn't load your balance."}</p>
            <button className="btn btn-primary btn-sm" onClick={() => reload()}>
              Try again
            </button>
          </div>
        )}
      </section>
    );
  }

  const acct = me.fundingAccount;
  const available = BigInt(me.balance.availableMinor);
  const held = BigInt(me.balance.ledgerMinor) - available;

  return (
    <section className="ap-card" aria-labelledby="bank-title">
      <div className="ap-card-head">
        <h2 id="bank-title">Naira</h2>
        <span className="ap-chip">{me.payments === "on" ? "Payments on" : "Payments paused"}</span>
      </div>
      <div>
        <span className="ap-hero-num" style={{ color: "var(--ink)" }} aria-live="polite">
          {formatMoney(available, "NGN")}
        </span>
        {held > 0n && <p className="ap-muted">{formatMoney(held, "NGN")} is set aside for a renewal in progress.</p>}
      </div>

      {acct ? (
        <>
          <p className="ap-muted">Transfer from any Nigerian bank app to this account. It shows up here within minutes.</p>
          <div className="ap-row ap-row-flat">
            <span className="ap-row-main">
              <b className="mono ap-account-num">{acct.accountNumber}</b>
              <small>
                {acct.bankName} · {acct.accountName}
              </small>
            </span>
            <button
              className="btn btn-primary btn-sm"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(acct.accountNumber);
                  notify("Account number copied");
                } catch {
                  notify("Couldn't copy. Press and hold the number to copy it.");
                }
              }}
            >
              Copy
            </button>
          </div>
        </>
      ) : (
        <form className="ap-form" onSubmit={create} noValidate>
          <p className="ap-muted">Get your own account number. Transfers to it fund your bills.</p>
          <div className="ap-grid-2">
            <Field label="First name">{(a) => <input {...a} autoComplete="given-name" value={first} onChange={(e) => setFirst(e.target.value)} />}</Field>
            <Field label="Last name">{(a) => <input {...a} autoComplete="family-name" value={last} onChange={(e) => setLast(e.target.value)} />}</Field>
          </div>
          <Field label="Mobile number" error={formError}>
            {(a) => <input {...a} inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0803 123 4567" />}
          </Field>
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? "Creating…" : "Get my account number"}
          </button>
          <p className="ap-fine">Held by our licensed payment partner. You can stop or remove any bill at any time.</p>
        </form>
      )}
    </section>
  );
}
