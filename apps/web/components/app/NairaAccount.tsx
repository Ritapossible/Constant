"use client";

import { useCallback, useEffect, useState } from "react";
import { CardTopUp } from "./CardTopUp";
import { formatMoney } from "@/lib/app/format";
import { VerifyIdentity } from "./VerifyIdentity";
import { useServer } from "./Server";
import { useNotify } from "./Toast";

/** The user's naira balance and their own account number for bank transfers (Paystack dedicated account). */
export function NairaAccount() {
  const { me, loading, error, call, reload } = useServer();
  const notify = useNotify();
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // Bank transfer is the main way in; card, USSD and QR sit behind "Other ways", open when coming back from one.
  const [otherOpen, setOtherOpen] = useState(false);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("topup")) setOtherOpen(true);
  }, []);

  /** Once verified (D-086), the account number is one tap: the details come from the verification. */
  const create = useCallback(async () => {
    setBusy(true);
    setFormError(null);
    try {
      await call("/v1/funding-account", { method: "POST", body: {} });
      await reload();
      notify("Your account number is ready");
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }, [call, reload, notify]);

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
        {BigInt(me.balance.potsMinor) > 0n && (
          <p className="ap-muted">
            {formatMoney(BigInt(me.balance.potsMinor), "NGN")} set aside in bill pots · {formatMoney(BigInt(me.balance.freeMinor), "NGN")} free
          </p>
        )}
        {held > 0n && <p className="ap-muted">{formatMoney(held, "NGN")} is being used for a payment in progress.</p>}
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
        me.user.kycTier >= 1 ? (
          <div className="ap-form">
            <p className="ap-muted">Your identity is verified. Get your own account number and send money to it from any Nigerian bank or mobile money app. It&apos;s free.</p>
            {formError && (
              <p className="ap-muted" role="alert">
                {formError}
              </p>
            )}
            <button className="btn btn-primary" onClick={create} disabled={busy}>
              {busy ? "Creating…" : "Get my account number"}
            </button>
          </div>
        ) : (
          <VerifyIdentity onVerified={reload} />
        )
      )}
      {me.cardTopUps && (
        <details className="ap-other" open={otherOpen} onToggle={(e) => setOtherOpen((e.target as HTMLDetailsElement).open)}>
          <summary>Other ways to add money: card, USSD or QR</summary>
          <CardTopUp />
        </details>
      )}
    </section>
  );
}
