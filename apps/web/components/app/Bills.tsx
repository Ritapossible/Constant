"use client";

import { useMemo, useState } from "react";
import { KINDS, PROVIDERS, REF_LABEL, UNIT, isUsageKind, maskRef, validateRef, type Kind } from "@/lib/app/catalog";
import { formatDay, formatMoney, toMinor, type Currency } from "@/lib/app/format";
import { latest, outlook } from "@/lib/app/insights";
import { newId, type Line } from "@/lib/app/store";
import { outlookText } from "./Home";
import { KindIcon } from "./KindIcon";
import type { Store } from "./Shell";
import { Sheet } from "./Sheet";

export function Bills({ store }: { store: Store }) {
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const now = useMemo(() => new Date(), []);
  const open = store.plan.lines.find((l) => l.id === openId) ?? null;

  return (
    <div className="ap-page">
      <header className="ap-page-head ap-page-head-row">
        <div>
          <p className="ap-kicker">Bills</p>
          <h1>What Constant keeps paid</h1>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => setAdding(true)}>
          Add a bill
        </button>
      </header>

      {store.plan.lines.length === 0 ? (
        <div className="ap-empty">
          <p>
            <b>No bills yet.</b>
            <br />
            Start with the one that runs out most often.
          </p>
          <button className="btn btn-primary btn-sm" onClick={() => setAdding(true)}>
            Add a bill
          </button>
        </div>
      ) : (
        <ul className="ap-list">
          {store.plan.lines.map((l) => {
            const t = outlookText(l, outlook(l, now));
            return (
              <li key={l.id}>
                <button className="ap-row ap-row-btn" onClick={() => setOpenId(l.id)}>
                  <KindIcon kind={l.kind} />
                  <span className="ap-row-main">
                    <b>
                      {l.nickname}
                      {l.status === "paused" && <span className="ap-chip">Paused</span>}
                    </b>
                    <small>{t.sub}</small>
                    <small>
                      {providerName(l)} · {maskRef(l.kind, l.ref)}
                    </small>
                  </span>
                  <span className="ap-row-right">
                    <span className="mono">{t.right}</span>
                    <small>{formatMoney(BigInt(l.amountMinor), l.currency)}</small>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <Sheet open={adding} onClose={() => setAdding(false)} title="Add a bill">
        <AddBill
          onSave={(line) => {
            store.save((p) => ({ ...p, lines: [...p.lines, line] }));
            setAdding(false);
          }}
        />
      </Sheet>

      <Sheet open={open !== null} onClose={() => setOpenId(null)} title={open?.nickname ?? ""}>
        {open && (
          <BillDetail
            line={open}
            onChange={(next) => store.save((p) => ({ ...p, lines: p.lines.map((l) => (l.id === next.id ? next : l)) }))}
            onDelete={() => {
              store.save((p) => ({ ...p, lines: p.lines.filter((l) => l.id !== open.id) }));
              setOpenId(null);
            }}
          />
        )}
      </Sheet>
    </div>
  );
}

function providerName(l: Line) {
  return PROVIDERS[l.kind].find((p) => p.id === l.provider)?.name ?? l.provider;
}

/* ── Add ─────────────────────────────────────────────────── */

function AddBill({ onSave }: { onSave: (l: Line) => void }) {
  const [kind, setKind] = useState<Kind | null>(null);
  if (!kind) {
    return (
      <div className="ap-kind-grid">
        {KINDS.map((k) => (
          <button key={k.kind} className="ap-kind-card" onClick={() => setKind(k.kind)}>
            <KindIcon kind={k.kind} />
            <b>{k.label}</b>
            <small>{k.hint}</small>
          </button>
        ))}
      </div>
    );
  }
  return <BillForm kind={kind} onBack={() => setKind(null)} onSave={onSave} />;
}

function BillForm({ kind, onBack, onSave }: { kind: Kind; onBack: () => void; onSave: (l: Line) => void }) {
  const providers = PROVIDERS[kind];
  const usage = isUsageKind(kind);
  const currency: Currency = kind === "subscription" ? "USD" : "NGN";
  const [provider, setProvider] = useState(providers.find((p) => p.available)?.id ?? "");
  const [ref, setRef] = useState("");
  const [nickname, setNickname] = useState("");
  const [amount, setAmount] = useState("");
  const [threshold, setThreshold] = useState(kind === "data" ? "300" : kind === "electricity" ? "20" : kind === "airtime" ? "100" : "");
  const [current, setCurrent] = useState("");
  const [renewDay, setRenewDay] = useState("1");
  const [cap, setCap] = useState("");
  const [tried, setTried] = useState(false);

  const refErr = validateRef(kind, ref);
  const amountMinor = toMinor(amount);
  const amountErr = amountMinor === null || amountMinor <= 0n ? "Enter an amount" : null;
  const capMinor = cap ? toMinor(cap) : amountMinor;
  const capErr = cap && (capMinor === null || (amountMinor !== null && capMinor! < amountMinor)) ? "The cap can't be lower than one payment" : null;
  const thresholdNum = Number(threshold);
  const thresholdErr = usage && (!threshold || !Number.isFinite(thresholdNum) || thresholdNum < 0) ? "Enter your line" : null;
  const currentNum = current ? Number(current) : null;
  const currentErr = current && (!Number.isFinite(currentNum) || (currentNum ?? 0) < 0) ? "Enter a number" : null;
  const day = Number(renewDay);
  const dayErr = !usage && (!Number.isInteger(day) || day < 1 || day > 28) ? "Pick a day from 1 to 28" : null;
  const ok = !refErr && !amountErr && !capErr && !thresholdErr && !currentErr && !dayErr && provider;
  const pName = providers.find((p) => p.id === provider)?.name ?? "";

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setTried(true);
    if (!ok || amountMinor === null) return;
    const now = new Date().toISOString();
    onSave({
      id: newId(),
      kind,
      provider,
      ref: ref.trim(),
      nickname: nickname.trim() || `${pName} ${KINDS.find((k) => k.kind === kind)?.label.toLowerCase() ?? ""}`.trim(),
      currency,
      amountMinor: amountMinor.toString(),
      threshold: usage ? thresholdNum : undefined,
      renewDay: usage ? undefined : day,
      weeklyCapMinor: (capMinor ?? amountMinor).toString(),
      status: "active",
      readings: usage && currentNum !== null ? [{ at: now, value: currentNum }] : [],
      createdAt: now,
    });
  }

  const err = (m: string | null) => (tried && m ? <span className="ap-err">{m}</span> : null);

  return (
    <form className="ap-form" onSubmit={submit} noValidate>
      <button type="button" className="ap-back" onClick={onBack}>
        ← {KINDS.find((k) => k.kind === kind)?.label}
      </button>

      <fieldset className="ap-field">
        <legend>Provider</legend>
        <div className="ap-chips">
          {providers.map((p) => (
            <button
              type="button"
              key={p.id}
              className="ap-chip-btn"
              data-on={provider === p.id}
              disabled={!p.available}
              onClick={() => setProvider(p.id)}
              title={p.available ? undefined : "Coming soon"}
            >
              {p.name}
              {!p.available && <small> soon</small>}
            </button>
          ))}
        </div>
      </fieldset>

      <label className="ap-field">
        <span>{REF_LABEL[kind]}</span>
        <input
          inputMode={kind === "subscription" ? "email" : "numeric"}
          autoComplete="off"
          value={ref}
          onChange={(e) => setRef(e.target.value)}
          placeholder={kind === "subscription" ? "you@example.com" : kind === "electricity" ? "45012345678" : kind === "tv" ? "7012345678" : "0803 123 4567"}
        />
        {err(refErr)}
      </label>

      <label className="ap-field">
        <span>Name it (optional)</span>
        <input value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder={kind === "electricity" ? "Home meter" : kind === "tv" ? "Living room DSTV" : "My data"} maxLength={40} />
      </label>

      <div className="ap-grid-2">
        <label className="ap-field">
          <span>{usage ? "Each top-up" : "Each renewal"} ({currency === "NGN" ? "₦" : "$"})</span>
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={currency === "NGN" ? "5,000" : "20"} />
          {err(amountErr)}
        </label>
        {usage ? (
          <label className="ap-field">
            <span>Top up at ({UNIT[kind]})</span>
            <input inputMode="decimal" value={threshold} onChange={(e) => setThreshold(e.target.value)} />
            {err(thresholdErr)}
          </label>
        ) : (
          <label className="ap-field">
            <span>Renews on day</span>
            <input inputMode="numeric" value={renewDay} onChange={(e) => setRenewDay(e.target.value)} />
            {err(dayErr)}
          </label>
        )}
      </div>

      {usage && (
        <label className="ap-field">
          <span>What&apos;s left right now ({UNIT[kind]}, optional)</span>
          <input inputMode="decimal" value={current} onChange={(e) => setCurrent(e.target.value)} placeholder={kind === "electricity" ? "From your meter keypad" : "From your balance check"} />
          {err(currentErr)}
        </label>
      )}

      <label className="ap-field">
        <span>Weekly cap ({currency === "NGN" ? "₦" : "$"}, optional)</span>
        <input inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value)} placeholder="Defaults to one payment" />
        {err(capErr)}
      </label>

      <button className="btn btn-primary" type="submit">
        Save bill
      </button>
      <p className="ap-fine">Nothing is paid now. When payments open, Constant looks up the {REF_LABEL[kind].toLowerCase()} and shows you the name before the first payment.</p>
    </form>
  );
}

/* ── Detail ──────────────────────────────────────────────── */

function BillDetail({ line, onChange, onDelete }: { line: Line; onChange: (l: Line) => void; onDelete: () => void }) {
  const usage = isUsageKind(line.kind);
  const [reading, setReading] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const now = new Date();
  const t = outlookText(line, outlook(line, now));
  const last = latest(line.readings);
  const value = Number(reading);
  const readingOk = reading !== "" && Number.isFinite(value) && value >= 0;

  return (
    <div className="ap-detail">
      <div className="ap-detail-top">
        <KindIcon kind={line.kind} />
        <div>
          <b className="mono">{t.right}</b>
          <small>{t.sub}</small>
        </div>
      </div>

      <dl className="ap-dl">
        <div>
          <dt>Provider</dt>
          <dd>{providerName(line)}</dd>
        </div>
        <div>
          <dt>{REF_LABEL[line.kind]}</dt>
          <dd>{maskRef(line.kind, line.ref)}</dd>
        </div>
        <div>
          <dt>{usage ? "Each top-up" : "Each renewal"}</dt>
          <dd>{formatMoney(BigInt(line.amountMinor), line.currency)}</dd>
        </div>
        <div>
          <dt>{usage ? "Tops up at" : "Renews on"}</dt>
          <dd>{usage ? `${line.threshold} ${UNIT[line.kind]}` : `day ${line.renewDay} each month`}</dd>
        </div>
        <div>
          <dt>Weekly cap</dt>
          <dd>{formatMoney(BigInt(line.weeklyCapMinor), line.currency)}</dd>
        </div>
      </dl>

      {usage && (
        <form
          className="ap-reading"
          onSubmit={(e) => {
            e.preventDefault();
            if (!readingOk) return;
            onChange({ ...line, readings: [...line.readings, { at: new Date().toISOString(), value }].slice(-60) });
            setReading("");
          }}
        >
          <label className="ap-field" style={{ flex: 1 }}>
            <span>Log a reading ({UNIT[line.kind]})</span>
            <input inputMode="decimal" value={reading} onChange={(e) => setReading(e.target.value)} placeholder={last ? `Last: ${last.value}` : "What's left now"} />
          </label>
          <button className="btn btn-primary btn-sm" type="submit" disabled={!readingOk}>
            Save
          </button>
        </form>
      )}

      {usage && line.readings.length > 0 && (
        <ul className="ap-readings">
          {[...line.readings]
            .sort((a, b) => +new Date(b.at) - +new Date(a.at))
            .slice(0, 5)
            .map((r) => (
              <li key={r.at}>
                <span>{formatDay(new Date(r.at))}</span>
                <span className="mono">
                  {r.value.toLocaleString()} {UNIT[line.kind]}
                </span>
              </li>
            ))}
        </ul>
      )}

      <div className="ap-actions">
        <button className="btn btn-ghost btn-sm" onClick={() => onChange({ ...line, status: line.status === "active" ? "paused" : "active" })}>
          {line.status === "active" ? "Pause" : "Resume"}
        </button>
        {confirmDelete ? (
          <button className="btn btn-danger btn-sm" onClick={onDelete}>
            Confirm remove
          </button>
        ) : (
          <button className="btn btn-ghost btn-sm" onClick={() => setConfirmDelete(true)}>
            Remove
          </button>
        )}
      </div>
    </div>
  );
}
