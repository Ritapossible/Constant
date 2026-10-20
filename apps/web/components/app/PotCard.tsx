"use client";

import { useId, useState } from "react";
import { formatMoney, toMinor } from "@/lib/app/format";
import { useServer } from "./Server";
import { useNotify } from "./Toast";

/**
 * A bill's pot (D-083): money set aside that only this bill can use. It pays this bill first; free money covers the
 * rest. Moves go through the API, which checks there is enough.
 */
export function PotCard({ lineId, potMinor, needMinor, label }: { lineId: string; potMinor: bigint; needMinor: bigint | null; label: string }) {
  const server = useServer();
  const notify = useNotify();
  const id = useId();
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState<"in" | "out" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const free = BigInt(server.me?.balance.freeMinor ?? "0");
  const short = needMinor !== null && needMinor > potMinor ? needMinor - potMinor : 0n;
  const fill = short > 0n && short <= free ? short : null;
  const value = toMinor(amount);

  const move = async (direction: "in" | "out", minor: bigint) => {
    setBusy(direction);
    setError(null);
    try {
      await server.call(`/v1/lines/${lineId}/pot`, { method: "POST", body: { direction, amountMinor: minor.toString() } });
      await server.reload();
      setAmount("");
      notify(direction === "in" ? `${formatMoney(minor, "NGN")} set aside for ${label}` : `${formatMoney(minor, "NGN")} moved back to free money`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="ap-pot" aria-labelledby={`${id}-t`}>
      <div className="ap-pot-head">
        <span>
          <small id={`${id}-t`}>Set aside for this bill</small>
          <b className="mono">{formatMoney(potMinor, "NGN")}</b>
        </span>
        {needMinor !== null && (
          <small className="ap-pot-need">
            {short === 0n ? "Covers the next payment" : `${formatMoney(short, "NGN")} short of the next payment`}
          </small>
        )}
      </div>
      <p className="ap-hint" style={{ margin: 0 }}>
        Only this bill can use it, and it pays this bill first. Free money: {formatMoney(free, "NGN")}.
      </p>
      {fill !== null && (
        <button type="button" className="btn btn-primary btn-sm" disabled={busy !== null} onClick={() => move("in", fill)}>
          Set aside {formatMoney(fill, "NGN")} for the next payment
        </button>
      )}
      <div className="ap-pot-move">
        <div className="ap-amount" data-invalid={Boolean(error)}>
          <span aria-hidden="true">₦</span>
          <label htmlFor={id} className="sr-only">
            Amount
          </label>
          <input id={id} inputMode="decimal" placeholder="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy !== null || !value || value <= 0n} onClick={() => value && move("in", value)}>
          {busy === "in" ? "Adding…" : "Add"}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy !== null || !value || value <= 0n || potMinor === 0n} onClick={() => value && move("out", value)}>
          {busy === "out" ? "Moving…" : "Move back"}
        </button>
      </div>
      {error && (
        <p className="ap-err" role="alert" style={{ margin: 0 }}>
          {error}
        </p>
      )}
    </section>
  );
}
