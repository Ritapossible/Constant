"use client";

import { useId, useMemo, useRef, useState, type FormEvent } from "react";
import { KINDS, PROVIDERS, REF_LABEL, UNIT, isUsageKind, maskRef, validateRef, type Kind } from "@/lib/app/catalog";
import { formatDay, formatMoney, toMinor, type Currency } from "@/lib/app/format";
import { latest, outlook } from "@/lib/app/insights";
import { newId, type Line } from "@/lib/app/store";
import type { ServerLine } from "@/lib/app/api";
import { CableAdd, CableDetail, cableStatus, providerName as cableProviderName } from "./Cable";
import { outlookText } from "./Home";
import { Field } from "./Field";
import { KindIcon } from "./KindIcon";
import type { Store } from "./Shell";
import { useServer } from "./Server";
import { Sheet } from "./Sheet";
import { useNotify } from "./Toast";

const kindLabel = (k: Kind) => KINDS.find((x) => x.kind === k)?.label ?? k;
const providerName = (l: Pick<Line, "kind" | "provider">) => PROVIDERS[l.kind].find((p) => p.id === l.provider)?.name ?? l.provider;
const minorToInput = (minor: string) => {
  const v = BigInt(minor);
  const cents = v % 100n;
  return `${v / 100n}${cents ? "." + cents.toString().padStart(2, "0") : ""}`;
};

export function Bills({ store }: { store: Store }) {
  const notify = useNotify();
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const now = useMemo(() => new Date(), []);
  const server = useServer();
  const serverLines = server.me?.lines ?? [];
  const open = store.plan.lines.find((l) => l.id === openId) ?? null;
  const openServer = serverLines.find((l) => l.id === openId) ?? null;

  const update = (next: Line) => store.save((p) => ({ ...p, lines: p.lines.map((l) => (l.id === next.id ? next : l)) }));

  const remove = (line: Line) => {
    const index = store.plan.lines.findIndex((l) => l.id === line.id);
    store.save((p) => ({ ...p, lines: p.lines.filter((l) => l.id !== line.id) }));
    setOpenId(null);
    notify(`${line.nickname} removed`, {
      label: "Undo",
      run: () =>
        store.save((p) => {
          const lines = [...p.lines];
          lines.splice(Math.max(0, index), 0, line);
          return { ...p, lines };
        }),
    });
  };

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

      {server.enabled && server.error && !server.me && (
        <div className="ap-warn" role="alert">
          {server.error}{" "}
          <button className="ap-link" onClick={() => server.reload()}>
            Try again
          </button>
        </div>
      )}

      {serverLines.length > 0 && (
        <ul className="ap-list" aria-label="Paid automatically">
          {serverLines.map((l) => (
            <ServerRow key={l.id} line={l} onOpen={() => setOpenId(l.id)} />
          ))}
        </ul>
      )}

      {store.plan.lines.length === 0 && serverLines.length === 0 ? (
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
      ) : store.plan.lines.length === 0 ? null : (
        <ul className="ap-list" aria-label="Your bills">
          {store.plan.lines.map((l) => {
            const t = outlookText(l, outlook(l, now));
            return (
              <li key={l.id}>
                <button className="ap-row ap-row-btn" onClick={() => setOpenId(l.id)} aria-label={`${l.nickname}, ${t.right}, ${t.sub}. Open details`}>
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
          serverTv={server.enabled && server.me !== null}
          onServerSaved={(line) => {
            setAdding(false);
            notify(`${line.nickname} added. It renews automatically.`);
          }}
          onSave={(line) => {
            store.save((p) => ({ ...p, lines: [...p.lines, line] }));
            setAdding(false);
            notify(`${line.nickname} added`);
          }}
        />
      </Sheet>

      <Sheet open={open !== null} onClose={() => setOpenId(null)} title={open?.nickname ?? ""}>
        {open && <BillDetail line={open} onChange={update} onDelete={() => remove(open)} />}
      </Sheet>

      <Sheet open={openServer !== null} onClose={() => setOpenId(null)} title={openServer?.nickname ?? ""}>
        {openServer && (
          <CableDetail line={openServer} orders={(server.me?.orders ?? []).filter((o) => o.lineId === openServer.id)} onClose={() => setOpenId(null)} />
        )}
      </Sheet>
    </div>
  );
}

/* ── Add ─────────────────────────────────────────────────── */

function ServerRow({ line, onOpen }: { line: ServerLine; onOpen: () => void }) {
  const t = cableStatus(line);
  return (
    <li>
      <button className="ap-row ap-row-btn" onClick={onOpen} aria-label={`${line.nickname}, ${t.right}, ${t.sub}. Open details`}>
        <KindIcon kind="tv" />
        <span className="ap-row-main">
          <b>
            {line.nickname}
            {line.status !== "active" && <span className="ap-chip">{line.status === "paused" ? "Paused" : "On hold"}</span>}
          </b>
          <small>{t.sub}</small>
          <small>
            {cableProviderName(line.provider)} · ••{line.last4}
          </small>
        </span>
        <span className="ap-row-right">
          <span className="mono">{t.right}</span>
          <small>up to {formatMoney(BigInt(line.capMinor), "NGN")}</small>
        </span>
      </button>
    </li>
  );
}

function AddBill({ onSave, serverTv, onServerSaved }: { onSave: (l: Line) => void; serverTv: boolean; onServerSaved: (l: ServerLine) => void }) {
  const [kind, setKind] = useState<Kind | null>(null);
  if (!kind) {
    return (
      <div className="ap-kind-grid" role="group" aria-label="What do you want to keep paid?">
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
  // Cable TV is the first bill paid for real, on the server. The rest stay on this device for now.
  if (kind === "tv" && serverTv) return <CableAdd onBack={() => setKind(null)} onDone={onServerSaved} />;
  return <BillForm kind={kind} onBack={() => setKind(null)} onSave={onSave} />;
}

/* ── Form (add and edit) ─────────────────────────────────── */

function BillForm({
  kind,
  initial,
  onBack,
  onSave,
}: {
  kind: Kind;
  initial?: Line;
  onBack?: () => void;
  onSave: (l: Line) => void;
}) {
  const providers = PROVIDERS[kind];
  const usage = isUsageKind(kind);
  const currency: Currency = initial?.currency ?? (kind === "subscription" ? "USD" : "NGN");
  const sym = currency === "NGN" ? "₦" : "$";
  const formRef = useRef<HTMLFormElement>(null);

  const [provider, setProvider] = useState(initial?.provider ?? providers.find((p) => p.available)?.id ?? "");
  const [ref, setRef] = useState(initial?.ref ?? "");
  const [nickname, setNickname] = useState(initial?.nickname ?? "");
  const [amount, setAmount] = useState(initial ? minorToInput(initial.amountMinor) : "");
  const [threshold, setThreshold] = useState(
    initial?.threshold?.toString() ?? (kind === "data" ? "300" : kind === "electricity" ? "20" : kind === "airtime" ? "100" : ""),
  );
  const [current, setCurrent] = useState("");
  const [renewDay, setRenewDay] = useState(initial?.renewDay?.toString() ?? "1");
  const [cap, setCap] = useState(initial && initial.weeklyCapMinor !== initial.amountMinor ? minorToInput(initial.weeklyCapMinor) : "");
  const [tried, setTried] = useState(false);

  const amountMinor = toMinor(amount);
  const capMinor = cap ? toMinor(cap) : amountMinor;
  const thresholdNum = Number(threshold);
  const currentNum = current ? Number(current) : null;
  const day = Number(renewDay);

  const errors = {
    ref: validateRef(kind, ref),
    amount: amountMinor === null || amountMinor <= 0n ? "Enter an amount, e.g. 5000" : null,
    cap:
      cap && capMinor === null
        ? "Enter a number"
        : cap && amountMinor !== null && capMinor !== null && capMinor < amountMinor
          ? "The cap can't be lower than one payment"
          : null,
    threshold: usage && (!threshold || !Number.isFinite(thresholdNum) || thresholdNum < 0) ? "Enter the level to top up at" : null,
    current: current && (!Number.isFinite(currentNum) || (currentNum ?? 0) < 0) ? "Enter a number" : null,
    day: !usage && (!Number.isInteger(day) || day < 1 || day > 28) ? "Pick a day from 1 to 28" : null,
  };
  const ok = Object.values(errors).every((e) => !e) && provider;
  const show = (e: string | null) => (tried ? e : null);
  const pName = providers.find((p) => p.id === provider)?.name ?? "";

  function submit(e: FormEvent) {
    e.preventDefault();
    setTried(true);
    if (!ok || amountMinor === null) {
      // Take the person straight to the first thing to fix.
      setTimeout(() => formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(), 0);
      return;
    }
    const now = new Date().toISOString();
    const readings = initial?.readings ?? [];
    onSave({
      id: initial?.id ?? newId(),
      kind,
      provider,
      ref: ref.trim(),
      nickname: nickname.trim() || `${pName} ${kindLabel(kind).toLowerCase()}`.trim(),
      currency,
      amountMinor: amountMinor.toString(),
      threshold: usage ? thresholdNum : undefined,
      renewDay: usage ? undefined : day,
      weeklyCapMinor: (capMinor ?? amountMinor).toString(),
      status: initial?.status ?? "active",
      readings: usage && currentNum !== null ? [...readings, { at: now, value: currentNum }] : readings,
      createdAt: initial?.createdAt ?? now,
    });
  }

  return (
    <form className="ap-form" onSubmit={submit} noValidate ref={formRef}>
      {onBack && (
        <button type="button" className="ap-back" onClick={onBack}>
          <span aria-hidden="true">←</span> {kindLabel(kind)}
        </button>
      )}

      <fieldset className="ap-field">
        <legend>Provider</legend>
        <div className="ap-chips" role="radiogroup" aria-label="Provider">
          {providers.map((p) => (
            <button
              type="button"
              key={p.id}
              role="radio"
              aria-checked={provider === p.id}
              className="ap-chip-btn"
              data-on={provider === p.id}
              disabled={!p.available}
              onClick={() => setProvider(p.id)}
            >
              {p.name}
              {!p.available && <small>soon</small>}
            </button>
          ))}
        </div>
      </fieldset>

      <Field label={REF_LABEL[kind]} error={show(errors.ref)}>
        {(a) => (
          <input
            {...a}
            inputMode={kind === "subscription" ? "email" : "numeric"}
            autoComplete={kind === "subscription" ? "email" : kind === "data" || kind === "airtime" ? "tel" : "off"}
            value={ref}
            onChange={(e) => setRef(e.target.value)}
            placeholder={kind === "subscription" ? "you@example.com" : kind === "electricity" ? "45012345678" : kind === "tv" ? "7012345678" : "0803 123 4567"}
          />
        )}
      </Field>

      <Field label="Name (optional)" hint="So you can tell bills apart">
        {(a) => (
          <input
            {...a}
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            placeholder={kind === "electricity" ? "Home meter" : kind === "tv" ? "Living room DSTV" : "My data"}
            maxLength={40}
          />
        )}
      </Field>

      <div className="ap-grid-2">
        <Field label={`${usage ? "Each top-up" : "Each renewal"} (${sym})`} error={show(errors.amount)}>
          {(a) => <input {...a} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={currency === "NGN" ? "5,000" : "20"} />}
        </Field>
        {usage ? (
          <Field label={`Top up at (${UNIT[kind]})`} error={show(errors.threshold)}>
            {(a) => <input {...a} inputMode="decimal" value={threshold} onChange={(e) => setThreshold(e.target.value)} />}
          </Field>
        ) : (
          <Field label="Renews on day" error={show(errors.day)} hint="1 to 28">
            {(a) => <input {...a} inputMode="numeric" value={renewDay} onChange={(e) => setRenewDay(e.target.value)} />}
          </Field>
        )}
      </div>

      {usage && (
        <Field
          label={`${initial ? "New reading" : "What's left now"} (${UNIT[kind]}, optional)`}
          error={show(errors.current)}
          hint={kind === "electricity" ? "Read it from the keypad inside your home" : "From your network's balance check"}
        >
          {(a) => <input {...a} inputMode="decimal" value={current} onChange={(e) => setCurrent(e.target.value)} />}
        </Field>
      )}

      <Field label={`Weekly cap (${sym}, optional)`} error={show(errors.cap)} hint="Constant never spends more than this in a week. Defaults to one payment.">
        {(a) => <input {...a} inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value)} />}
      </Field>

      {tried && !ok && (
        <p className="ap-err" role="alert">
          Check the highlighted fields.
        </p>
      )}

      <button className="btn btn-primary" type="submit">
        {initial ? "Save changes" : "Save bill"}
      </button>
      {!initial && (
        <p className="ap-fine">
          Nothing is paid now. When payments open, Constant checks the {REF_LABEL[kind].toLowerCase()} and shows you the name before the first payment.
        </p>
      )}
    </form>
  );
}

/* ── Detail ──────────────────────────────────────────────── */

function BillDetail({ line, onChange, onDelete }: { line: Line; onChange: (l: Line) => void; onDelete: () => void }) {
  const notify = useNotify();
  const usage = isUsageKind(line.kind);
  const [editing, setEditing] = useState(false);
  const [reading, setReading] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const readingId = useId();
  const t = outlookText(line, outlook(line, new Date()));
  const last = latest(line.readings);
  const value = Number(reading);
  const readingOk = reading.trim() !== "" && Number.isFinite(value) && value >= 0;

  if (editing) {
    return (
      <BillForm
        kind={line.kind}
        initial={line}
        onBack={() => setEditing(false)}
        onSave={(next) => {
          onChange(next);
          setEditing(false);
          notify("Changes saved");
        }}
      />
    );
  }

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
          <dd>{usage ? `${line.threshold} ${UNIT[line.kind]}` : `Day ${line.renewDay} of each month`}</dd>
        </div>
        <div>
          <dt>Weekly cap</dt>
          <dd>{formatMoney(BigInt(line.weeklyCapMinor), line.currency)}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{line.status === "active" ? "Active" : "Paused"}</dd>
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
            notify("Reading saved");
          }}
        >
          <div className="ap-field" style={{ flex: 1 }}>
            <label htmlFor={readingId}>Log a reading ({UNIT[line.kind]})</label>
            <input
              id={readingId}
              inputMode="decimal"
              value={reading}
              onChange={(e) => setReading(e.target.value)}
              placeholder={last ? `Last: ${last.value.toLocaleString()}` : "What's left now"}
            />
          </div>
          <button className="btn btn-primary btn-sm" type="submit" disabled={!readingOk}>
            Save
          </button>
        </form>
      )}

      {usage && line.readings.length > 0 && (
        <section aria-label="Recent readings">
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
        </section>
      )}

      <div className="ap-actions">
        <button className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>
          Edit
        </button>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => {
            const next = line.status === "active" ? "paused" : "active";
            onChange({ ...line, status: next });
            notify(next === "paused" ? "Paused. Nothing will be paid until you resume." : "Resumed");
          }}
        >
          {line.status === "active" ? "Pause" : "Resume"}
        </button>
        {confirmDelete ? (
          <>
            <button className="btn btn-danger btn-sm" onClick={onDelete}>
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
