"use client";

import { useId, useState } from "react";
import { formatMoney, toMinor } from "@/lib/app/format";
import { useServer } from "./Server";
import { useNotify } from "./Toast";

/**
 * A bill's pot (D-083): money set aside that only this bill can use. It pays this bill first; free money covers the
 * rest. Moves go through the API, which checks there is enough.
 */
export function PotCard({
  lineId,
  potMinor,
  needMinor,
  targetMinor,
  label,
}: {
  lineId: string;
  potMinor: bigint;
  needMinor: bigint | null;
  /** The level new money fills this pot to (D-084). */
  targetMinor: bigint | null;
  label: string;
}) {
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
      <AutoFill lineId={lineId} targetMinor={targetMinor} suggestMinor={needMinor} />
    </section>
  );
}

/** "When money arrives, keep ₦X set aside for this bill" (D-084). */
function AutoFill({ lineId, targetMinor, suggestMinor }: { lineId: string; targetMinor: bigint | null; suggestMinor: bigint | null }) {
  const server = useServer();
  const notify = useNotify();
  const id = useId();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const minor = toMinor(value);

  const save = async (v: bigint | null) => {
    setBusy(true);
    try {
      await server.call(`/v1/lines/${lineId}`, { method: "PATCH", body: { potTargetMinor: v === null ? null : v.toString() } });
      await server.reload();
      setEditing(false);
      notify(v === null ? "Automatic set-aside turned off" : `New money will keep ${formatMoney(v, "NGN")} set aside here`);
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!editing) {
    return (
      <div className="ap-pot-auto">
        <span className="ap-hint">
          {targetMinor ? (
            <>
              When money arrives, keep <b>{formatMoney(targetMinor, "NGN")}</b> set aside here.
            </>
          ) : (
            "Fill this pot automatically when money arrives."
          )}
        </span>
        <button
          type="button"
          className="ap-link"
          onClick={() => {
            setValue(targetMinor ? (targetMinor / 100n).toString() : suggestMinor ? ((suggestMinor + 99n) / 100n).toString() : "");
            setEditing(true);
          }}
        >
          {targetMinor ? "Change" : "Set up"}
        </button>
      </div>
    );
  }
  return (
    <div className="ap-pot-auto-edit">
      <label htmlFor={id} className="ap-hint">
        When money arrives, keep this much set aside for this bill. Bills due soonest are filled first; the rest stays free.
      </label>
      <div className="ap-pot-move">
        <div className="ap-amount">
          <span aria-hidden="true">₦</span>
          <input id={id} inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder="0" />
        </div>
        <button type="button" className="btn btn-primary btn-sm" disabled={busy || !minor || minor <= 0n} onClick={() => minor && save(minor)}>
          Save
        </button>
      </div>
      <div className="ap-actions">
        {targetMinor && (
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => save(null)}>
            Turn off
          </button>
        )}
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setEditing(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}
