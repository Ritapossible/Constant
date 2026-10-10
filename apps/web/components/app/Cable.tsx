"use client";

import { useState, type FormEvent } from "react";
import type { Lookup, ServerLine, ServerOrder } from "@/lib/app/api";
import { formatDay, formatMoney, toMinor } from "@/lib/app/format";
import { Field } from "./Field";
import { KindIcon } from "./KindIcon";
import { useServer } from "./Server";
import { useNotify } from "./Toast";

const PROVIDERS = [
  { id: "dstv", name: "DSTV", digits: "10" },
  { id: "gotv", name: "GOtv", digits: "10" },
  { id: "startimes", name: "StarTimes", digits: "11" },
] as const;

type ProviderId = (typeof PROVIDERS)[number]["id"];

export const providerName = (id: string) => PROVIDERS.find((p) => p.id === id)?.name ?? id;
const naira = (minor: string | bigint) => formatMoney(BigInt(minor), "NGN");
const minorToInput = (minor: string) => (BigInt(minor) / 100n).toString();

/** What a server cable bill shows in a list: when it renews next, or why it won't. */
export function cableStatus(l: ServerLine): { right: string; sub: string } {
  if (l.status === "frozen") return { right: "On hold", sub: "We're checking a payment" };
  if (l.status === "paused") return { right: "Paused", sub: "Won't renew until you resume" };
  if (l.nextRunAt) return { right: formatDay(new Date(l.nextRunAt)), sub: "renews automatically" };
  return { right: "—", sub: "not scheduled" };
}

/* ── Add: find the decoder, confirm, save on the server ─────────────── */

export function CableAdd({ onBack, onDone }: { onBack: () => void; onDone: (l: ServerLine) => void }) {
  const { call, reload } = useServer();
  const [provider, setProvider] = useState<ProviderId>("dstv");
  const [card, setCard] = useState("");
  const [found, setFound] = useState<Lookup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [nickname, setNickname] = useState("");
  const [cap, setCap] = useState("");
  const [dueDate, setDueDate] = useState("");

  const digits = card.replace(/\s/g, "");

  async function find(e: FormEvent) {
    e.preventDefault();
    if (!/^\d{10,12}$/.test(digits)) {
      setError(`Enter the ${PROVIDERS.find((p) => p.id === provider)!.digits} digit number on your decoder`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await call<Lookup>("/v1/cable/lookup", { method: "POST", body: { provider, smartcard: digits } });
      setFound(r);
      setCap(r.renewalAmountMinor ? minorToInput(r.renewalAmountMinor) : "");
      setNickname(`${providerName(provider)} ••${digits.slice(-4)}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const capMinor = toMinor(cap);
  const capError = capMinor === null || capMinor <= 0n ? "Enter the most you'll pay per renewal" : null;
  const dueError = found && !found.dueAt && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate) ? "Pick the date it ends" : null;
  const priceAboveCap = found?.renewalAmountMinor && capMinor !== null && capMinor < BigInt(found.renewalAmountMinor);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (capError || dueError || capMinor === null) return setError("Check the highlighted fields.");
    setBusy(true);
    setError(null);
    try {
      const line = await call<ServerLine>("/v1/lines", {
        method: "POST",
        body: { provider, smartcard: digits, nickname: nickname.trim() || undefined, capMinor: capMinor.toString(), ...(found?.dueAt ? {} : { dueDate }) },
      });
      await reload();
      onDone(line);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  if (!found) {
    return (
      <form className="ap-form" onSubmit={find} noValidate>
        <button type="button" className="ap-back" onClick={onBack}>
          <span aria-hidden="true">←</span> Cable TV
        </button>
        <fieldset className="ap-field">
          <legend>Provider</legend>
          <div className="ap-chips" role="radiogroup" aria-label="Provider">
            {PROVIDERS.map((p) => (
              <button type="button" key={p.id} role="radio" aria-checked={provider === p.id} className="ap-chip-btn" data-on={provider === p.id} onClick={() => setProvider(p.id)}>
                {p.name}
              </button>
            ))}
          </div>
        </fieldset>
        <Field label={provider === "dstv" ? "Smartcard number" : "IUC number"} error={error} hint="On a sticker under the decoder, or press Info on the remote">
          {(a) => <input {...a} inputMode="numeric" autoComplete="off" value={card} onChange={(e) => setCard(e.target.value)} placeholder="7012345678" />}
        </Field>
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? "Finding your decoder…" : "Find my decoder"}
        </button>
      </form>
    );
  }

  return (
    <form className="ap-form" onSubmit={save} noValidate>
      <button type="button" className="ap-back" onClick={() => setFound(null)}>
        <span aria-hidden="true">←</span> Change number
      </button>
      <div className="ap-confirm" role="status">
        <KindIcon kind="tv" />
        <div>
          <b>{found.customerName}</b>
          <small>
            {providerName(provider)} ••{digits.slice(-4)}
            {found.currentPlan ? ` · ${found.currentPlan}` : ""}
          </small>
        </div>
      </div>
      <dl className="ap-dl">
        <div>
          <dt>Renewal price now</dt>
          <dd>{found.renewalAmountMinor ? naira(found.renewalAmountMinor) : "Shown at renewal"}</dd>
        </div>
        <div>
          <dt>Current plan ends</dt>
          <dd>{found.dueAt ? formatDay(new Date(found.dueAt)) : "Tell us below"}</dd>
        </div>
      </dl>
      <p className="ap-muted">Not your name? Go back and check the number.</p>

      {!found.dueAt && (
        <Field label="Subscription ends on" error={dueError}>
          {(a) => <input {...a} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />}
        </Field>
      )}
      <Field
        label="Most to pay per renewal (₦)"
        error={capError}
        hint={priceAboveCap ? "This is below today's price, so the next renewal will wait for you." : "If the price goes above this, we ask you first."}
      >
        {(a) => <input {...a} inputMode="numeric" value={cap} onChange={(e) => setCap(e.target.value)} />}
      </Field>
      <Field label="Name (optional)">
        {(a) => <input {...a} value={nickname} onChange={(e) => setNickname(e.target.value)} maxLength={40} />}
      </Field>
      {error && (
        <p className="ap-err" role="alert">
          {error}
        </p>
      )}
      <button className="btn btn-primary" type="submit" disabled={busy}>
        {busy ? "Saving…" : "Renew this automatically"}
      </button>
      <p className="ap-fine">Nothing is paid now. Constant renews the day before your plan ends, from your naira balance, and tells you when it's done.</p>
    </form>
  );
}

/* ── Detail ───────────────────────────────────────────────────────── */

const ORDER_LABEL: Record<ServerOrder["state"], string> = {
  ready: "Starting",
  vending: "Paying",
  token_stored: "Paid",
  notifying: "Paid",
  settled: "Paid",
  failed: "Not paid",
  needs_human: "Being checked",
};

export function CableDetail({ line, orders, onClose }: { line: ServerLine; orders: ServerOrder[]; onClose: () => void }) {
  const { call, reload } = useServer();
  const notify = useNotify();
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [cap, setCap] = useState(minorToInput(line.capMinor));
  const t = cableStatus(line);
  const capMinor = toMinor(cap);
  const capChanged = capMinor !== null && capMinor > 0n && capMinor.toString() !== line.capMinor;

  async function run(fn: () => Promise<unknown>, done: string) {
    setBusy(true);
    try {
      await fn();
      await reload();
      notify(done);
    } catch (err) {
      notify((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ap-detail">
      <div className="ap-detail-top">
        <KindIcon kind="tv" />
        <div>
          <b className="mono">{t.right}</b>
          <small>{t.sub}</small>
        </div>
      </div>

      {line.status === "frozen" && (
        <div className="ap-warn" role="note">
          A payment for this bill needs a person to confirm it. Nothing more will be paid until we've checked. We'll message you.
        </div>
      )}

      <dl className="ap-dl">
        <div>
          <dt>Decoder</dt>
          <dd>
            {providerName(line.provider)} ••{line.last4}
          </dd>
        </div>
        <div>
          <dt>Name on account</dt>
          <dd>{line.customerName ?? "—"}</dd>
        </div>
        {line.planName && (
          <div>
            <dt>Plan</dt>
            <dd>{line.planName}</dd>
          </div>
        )}
        <div>
          <dt>Plan ends</dt>
          <dd>{line.dueAt ? formatDay(new Date(line.dueAt)) : "—"}</dd>
        </div>
        <div>
          <dt>Last renewed</dt>
          <dd>{line.lastRenewedAt ? formatDay(new Date(line.lastRenewedAt)) : "Not yet"}</dd>
        </div>
      </dl>

      <form
        className="ap-reading"
        onSubmit={(e) => {
          e.preventDefault();
          if (capChanged) run(() => call(`/v1/lines/${line.id}`, { method: "PATCH", body: { capMinor: capMinor!.toString() } }), "Limit saved");
        }}
      >
        <div style={{ flex: 1 }}>
          <Field label="Most to pay per renewal (₦)">{(a) => <input {...a} inputMode="numeric" value={cap} onChange={(e) => setCap(e.target.value)} />}</Field>
        </div>
        <button className="btn btn-primary btn-sm" type="submit" disabled={!capChanged || busy}>
          Save
        </button>
      </form>

      {orders.length > 0 && (
        <section aria-label="Renewals">
          <ul className="ap-readings">
            {orders.slice(0, 6).map((o) => (
              <li key={o.id}>
                <span>
                  {formatDay(new Date(o.createdAt))} · {ORDER_LABEL[o.state]}
                </span>
                <span className="mono">
                  {naira(o.amountMinor)}
                  {(o.state === "settled" || o.state === "notifying") && (
                    <>
                      {" · "}
                      <a href={`/r/${o.receiptId}`} target="_blank" rel="noreferrer">
                        Receipt
                      </a>
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="ap-actions">
        {line.status !== "frozen" && (
          <button
            className="btn btn-ghost btn-sm"
            disabled={busy}
            onClick={() =>
              run(
                () => call(`/v1/lines/${line.id}`, { method: "PATCH", body: { status: line.status === "active" ? "paused" : "active" } }),
                line.status === "active" ? "Paused. Nothing will be paid until you resume." : "Resumed",
              )
            }
          >
            {line.status === "active" ? "Pause" : "Resume"}
          </button>
        )}
        {confirmDelete ? (
          <>
            <button
              className="btn btn-danger btn-sm"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await call(`/v1/lines/${line.id}`, { method: "DELETE" });
                  onClose();
                }, `${line.nickname} removed`)
              }
            >
              Yes, remove
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setConfirmDelete(false)}>
              Keep it
            </button>
          </>
        ) : (
          <button className="btn btn-ghost btn-sm" onClick={() => setConfirmDelete(true)}>
            Remove
          </button>
        )}
      </div>
    </div>
  );
}
