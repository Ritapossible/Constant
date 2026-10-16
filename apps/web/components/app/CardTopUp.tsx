"use client";

import { TOPUP_MAX_MINOR, TOPUP_MIN_MINOR, topUpCharge } from "@constant/rules";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { Topup } from "@/lib/app/api";
import { formatMoney } from "@/lib/app/format";
import { useServer } from "./Server";
import { useNotify } from "./Toast";

const QUICK = [2_000, 5_000, 10_000, 20_000];

function toMinor(v: string): bigint | null {
  const t = v.replace(/[,\s₦]/g, "");
  if (!/^\d{1,9}$/.test(t)) return null;
  return BigInt(t) * 100n;
}

/**
 * Add money by card, USSD or QR through Paystack (D-075). Paystack's fee is shown and added at cost, so the full
 * amount reaches the balance. Paystack sends the person back to /app?topup=…, and this asks the API how it went.
 */
export function CardTopUp() {
  const { call, reload } = useServer();
  const notify = useNotify();
  const id = useId();
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const handled = useRef(false);

  const credit = toMinor(amount);
  const quote = useMemo(() => {
    if (credit === null || credit < TOPUP_MIN_MINOR || credit > TOPUP_MAX_MINOR) return null;
    return topUpCharge(credit);
  }, [credit]);

  // Back from Paystack: ask the API (it verifies with Paystack), a few times, then tidy the address bar.
  useEffect(() => {
    const topupId = new URLSearchParams(window.location.search).get("topup");
    if (!topupId || handled.current) return;
    handled.current = true;
    window.history.replaceState(null, "", `${window.location.pathname}#money`);
    setChecking(true);
    let stop = false;
    (async () => {
      for (let i = 0; i < 8 && !stop; i++) {
        try {
          const t = await call<Topup>(`/v1/topups/${encodeURIComponent(topupId)}`);
          if (t.status === "credited") {
            notify(`${formatMoney(BigInt(t.creditMinor), "NGN")} added to your balance`);
            await reload();
            break;
          }
          if (t.status === "failed") {
            notify("The payment didn't go through. Nothing was taken.");
            break;
          }
          if (t.status === "mismatch") {
            notify("We received a payment we need to check. We'll contact you shortly.");
            break;
          }
        } catch {
          // keep trying; the webhook may still land
        }
        await new Promise((r) => setTimeout(r, 2500));
        if (i === 7) notify("Still confirming your payment. Your balance updates as soon as it lands.");
      }
      setChecking(false);
    })();
    return () => {
      stop = true;
    };
  }, [call, notify, reload]);

  async function pay() {
    if (!quote) {
      setError(`Enter an amount between ${formatMoney(TOPUP_MIN_MINOR, "NGN")} and ${formatMoney(TOPUP_MAX_MINOR, "NGN")}`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const t = await call<Topup>("/v1/topups", { method: "POST", body: { amountMinor: quote.creditMinor.toString() } });
      if (!t.authorizationUrl) throw new Error("Couldn't open the payment page. Try again.");
      window.location.assign(t.authorizationUrl);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="ap-topup" aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`}>Card, USSD or QR</h3>
      <p className="ap-muted">Pay with any Nigerian bank card, a USSD code or a bank app QR, through Paystack.</p>
      {checking && (
        <div className="ap-inline-state" role="status">
          <span className="ap-spinner" aria-hidden="true" />
          <p className="ap-muted">Confirming your payment…</p>
        </div>
      )}
      <div className="ap-field">
        <label htmlFor={`${id}-amount`}>Amount to add</label>
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
            aria-describedby={`${id}-quote`}
          />
        </div>
        <div className="ap-quick" role="group" aria-label="Quick amounts">
          {QUICK.map((n) => (
            <button type="button" key={n} className="ap-quick-btn" data-on={credit === BigInt(n) * 100n} onClick={() => setAmount(String(n))}>
              {formatMoney(BigInt(n) * 100n, "NGN")}
            </button>
          ))}
        </div>
      </div>
      <p id={`${id}-quote`} className="ap-topup-quote" aria-live="polite">
        {quote ? (
          <>
            Paystack&apos;s fee {formatMoney(quote.feeMinor, "NGN")} · You pay <b>{formatMoney(quote.totalMinor, "NGN")}</b>
          </>
        ) : (
          `From ${formatMoney(TOPUP_MIN_MINOR, "NGN")} to ${formatMoney(TOPUP_MAX_MINOR, "NGN")}. A bank transfer to your account number is free.`
        )}
      </p>
      {error && (
        <span className="ap-err" role="alert">
          {error}
        </span>
      )}
      <button className="btn btn-primary" type="button" onClick={pay} disabled={busy || checking}>
        {busy ? "Opening Paystack…" : quote ? `Pay ${formatMoney(quote.totalMinor, "NGN")}` : "Continue"}
      </button>
      <p className="ap-fine">Paystack&apos;s fee is passed on at cost. ConstantUnits adds nothing.</p>
    </div>
  );
}
