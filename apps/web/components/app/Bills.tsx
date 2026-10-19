"use client";

import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { MIN_AUTOPAY_MINOR } from "@constant/rules";
import { feeNote } from "@/lib/pricing";
import { KINDS, PROVIDERS, QUICK_AMOUNTS, REF_LABEL, UNIT, isUsageKind, isUsageLine, maskRef, networkFor, validateRef, type Kind, type MeterType } from "@/lib/app/catalog";
import { formatDay, formatMoney, toMinor, type Currency } from "@/lib/app/format";
import { latest, nextRenewal, outlook } from "@/lib/app/insights";
import { newId, type Line } from "@/lib/app/store";
import type { DataPlan, MeterCheck, ServerLine, ServerOrder } from "@/lib/app/api";
import { CableAdd, CableDetail, cableStatus, providerName as cableProviderName } from "./Cable";
import { outlookText } from "./Home";
import { Field } from "./Field";
import { KindIcon } from "./KindIcon";
import { ProviderLogo } from "./ProviderLogo";
import { NetworkPicker, ProviderGrid } from "./ProviderPicker";
import type { Store } from "./Shell";
import { useServer } from "./Server";
import { Sheet } from "./Sheet";
import { useNotify } from "./Toast";

const kindLabel = (k: Kind) => KINDS.find((x) => x.kind === k)?.label ?? k;
const providerName = (l: Pick<Line, "kind" | "provider">) => PROVIDERS[l.kind].find((p) => p.id === l.provider)?.name ?? l.provider;
const providerFull = (l: Pick<Line, "kind" | "provider">) => {
  const p = PROVIDERS[l.kind].find((x) => x.id === l.provider);
  return p?.full ?? p?.name ?? l.provider;
};
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
  const cable = (server.me?.lines ?? []).filter((l) => l.kind === "tv");
  const open = store.plan.lines.find((l) => l.id === openId) ?? null;
  const openServer = cable.find((l) => l.id === openId) ?? null;
  const orders = server.me?.orders ?? [];

  const remove = async (line: Line) => {
    if (line.onServer) {
      try {
        await store.remove(line);
        setOpenId(null);
        notify(`${line.nickname} removed`);
      } catch (e) {
        notify((e as Error).message);
      }
      return;
    }
    await store.remove(line);
    setOpenId(null);
    notify(`${line.nickname} removed`, { label: "Undo", run: () => void store.add(line) });
  };

  return (
    <div className="ap-page">
      <header className="ap-page-head ap-page-head-row">
        <div>
          <p className="ap-kicker">Bills</p>
          <h1>What ConstantUnits keeps paid</h1>
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

      {store.unmoved.length > 0 && <Unmoved store={store} />}

      {cable.length > 0 && (
        <ul className="ap-list" aria-label="Cable TV">
          {cable.map((l) => (
            <ServerRow key={l.id} line={l} onOpen={() => setOpenId(l.id)} />
          ))}
        </ul>
      )}

      {store.plan.lines.length === 0 && cable.length === 0 ? (
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
            const t = lineStatus(l, now);
            return (
              <li key={l.id}>
                <button className="ap-row ap-row-btn" onClick={() => setOpenId(l.id)} aria-label={`${l.nickname}, ${t.right}, ${t.sub}. Open details`}>
                  <ProviderLogo kind={l.kind} id={l.provider} />
                  <span className="ap-row-main">
                    <b>
                      {l.nickname}
                      {l.held ? <span className="ap-chip">On hold</span> : l.setupNeeded ? <span className="ap-chip">Choose a bundle</span> : l.status === "paused" && <span className="ap-chip">Paused</span>}
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
          isFirst={store.plan.lines.length + cable.length === 0}
          serverTv={server.enabled && server.me !== null}
          onServer={store.onServer}
          onServerSaved={(line) => {
            setAdding(false);
            notify(`${line.nickname} added. It renews automatically.`);
          }}
          onSave={async (line, extra) => {
            await store.add(line, extra);
            setAdding(false);
            notify(store.onServer ? `${line.nickname} saved to your account` : `${line.nickname} added`);
          }}
        />
      </Sheet>

      <Sheet open={open !== null} onClose={() => setOpenId(null)} title={open?.nickname ?? ""}>
        {open && <BillDetail line={open} store={store} orders={orders.filter((o) => o.lineId === open.id)} onDelete={() => remove(open)} />}
      </Sheet>

      <Sheet open={openServer !== null} onClose={() => setOpenId(null)} title={openServer?.nickname ?? ""}>
        {openServer && <CableDetail line={openServer} orders={orders.filter((o) => o.lineId === openServer.id)} onClose={() => setOpenId(null)} />}
      </Sheet>
    </div>
  );
}

/** A bill's line in the list: the next payment for a dated bill, the forecast or state for a top-up bill. */
function lineStatus(l: Line, now: Date): { right: string; sub: string } {
  if (l.held) return { right: "On hold", sub: "We're checking a payment" };
  if (l.setupNeeded) return { right: "Set up", sub: "Choose a bundle to turn it on" };
  if (l.status === "paused") return { right: "Paused", sub: "Nothing is paid until you resume" };
  if (l.kind === "subscription") return { right: formatDay(nextRenewal(l.renewDay ?? 1, now)), sub: "renews (reminder only)" };
  if (l.onServer && !isUsageLine(l) && l.nextRunAt) return { right: formatDay(new Date(l.nextRunAt)), sub: "paid automatically" };
  return outlookText(l, outlook(l, now));
}

/** Bills from the preview that the account didn't accept: say why, and let the person drop them. */
function Unmoved({ store }: { store: Store }) {
  return (
    <div className="ap-warn" role="alert">
      <p style={{ margin: "0 0 8px" }}>
        <b>Some bills saved on this phone couldn&apos;t move to your account.</b> They aren&apos;t paid until you add them again.
      </p>
      <ul className="ap-unmoved">
        {store.unmoved.map((u) => (
          <li key={u.line.id}>
            <b>{u.line.nickname}</b> — {u.reason}
          </li>
        ))}
      </ul>
      <button className="btn btn-ghost btn-sm" onClick={() => store.dropFromDevice(store.unmoved.map((u) => u.line.id))}>
        Remove them from this phone
      </button>
    </div>
  );
}

/* ── Add ─────────────────────────────────────────────────── */

function ServerRow({ line, onOpen }: { line: ServerLine; onOpen: () => void }) {
  const t = cableStatus(line);
  return (
    <li>
      <button className="ap-row ap-row-btn" onClick={onOpen} aria-label={`${line.nickname}, ${t.right}, ${t.sub}. Open details`}>
        <ProviderLogo kind="tv" id={line.provider} />
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

type SaveBill = (l: Line, extra?: { variationCode?: string | null }) => Promise<void> | void;

function AddBill({
  onSave,
  serverTv,
  onServer,
  onServerSaved,
  isFirst,
}: {
  onSave: SaveBill;
  serverTv: boolean;
  onServer: boolean;
  onServerSaved: (l: ServerLine) => void;
  isFirst: boolean;
}) {
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
  // Cable looks the decoder up first; every other bill is saved through the form, to the account when it's on.
  if (kind === "tv" && serverTv) return <CableAdd onBack={() => setKind(null)} onDone={onServerSaved} isFirst={isFirst} />;
  return <BillForm kind={kind} onBack={() => setKind(null)} onSave={onSave} isFirst={isFirst} onServer={onServer} />;
}

/* ── Form (add and edit) ─────────────────────────────────── */

/** An example plan name for each subscription, as the name placeholder. */
const PLAN_HINT: Record<string, string> = {
  chatgpt: "ChatGPT Plus",
  claude: "Claude Pro",
  gemini: "Google AI Pro",
  spotify: "Spotify Premium",
  netflix: "Netflix Standard",
};

const MOBILE = (k: Kind): k is "airtime" | "data" => k === "airtime" || k === "data";

function BillForm({
  kind,
  initial,
  onBack,
  onSave,
  isFirst = false,
  onServer = false,
}: {
  kind: Kind;
  initial?: Line;
  onBack?: () => void;
  onSave: SaveBill;
  /** No other bill yet: its first delivered payment is free (D-077). */
  isFirst?: boolean;
  /** Saved to the account (D-079): the network sells bundles, meters are checked, and it pays on a day or when low. */
  onServer?: boolean;
}) {
  const providers = PROVIDERS[kind];
  const mobile = MOBILE(kind);
  const currency: Currency = initial?.currency ?? (kind === "subscription" ? "USD" : "NGN");
  const sym = currency === "NGN" ? "₦" : "$";
  const formRef = useRef<HTMLFormElement>(null);
  const quick = currency === "NGN" ? QUICK_AMOUNTS[kind] : undefined;
  const uid = useId();
  const phoneId = `${uid}-phone`;
  const amountId = `${uid}-amount`;

  // Mobile bills start at the number (the network follows from it); the rest start by choosing the provider.
  const [step, setStep] = useState<"provider" | "details">(initial || mobile ? "details" : "provider");
  const [provider, setProvider] = useState(initial?.provider ?? (mobile ? "" : ""));
  const [pickedByHand, setPickedByHand] = useState(Boolean(initial));
  const [meterType, setMeterType] = useState<MeterType>(initial?.meterType ?? "prepaid");
  // On the account, data, airtime and prepaid power can pay on a day each month (fully automatic) or when the person
  // reports it low. The phone preview only knew "when low".
  const canChoose = onServer && !initial && isUsageKind(kind) && !(kind === "electricity" && meterType === "postpaid");
  const [when, setWhen] = useState<"monthly" | "usage">(initial?.schedule === "usage" ? "usage" : "monthly");
  const usage = initial?.schedule ? initial.schedule === "usage" : onServer ? canChoose && when === "usage" : isUsageLine({ kind, meterType });
  const refLocked = Boolean(initial?.onServer);
  const bundlesOn = onServer && kind === "data";
  const [variation, setVariation] = useState<string | null>(initial?.variationCode ?? null);
  const [busy, setBusy] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
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

  const detected = mobile && !refLocked ? networkFor(ref) : null;
  // Follow the number until the person picks a network themselves (ported numbers keep their old prefix).
  const effectiveProvider = mobile && !pickedByHand ? (detected ?? provider) : provider;
  const bundles = useBundles(bundlesOn ? effectiveProvider : null);
  const bundle = bundles.plans?.find((b) => b.code === variation) ?? null;
  const meter = useMeterCheck(onServer && kind === "electricity" && !initial ? { provider: effectiveProvider, ref, meterType } : null);

  const amountMinor = bundlesOn ? (bundle ? BigInt(bundle.amountMinor) : variation && initial ? BigInt(initial.amountMinor) : null) : toMinor(amount);
  const capMinor = cap ? toMinor(cap) : amountMinor;
  const thresholdNum = Number(threshold);
  const currentNum = current ? Number(current) : null;
  const day = Number(renewDay);

  // Data and airtime autopay start at ₦500, so the fee stays a small share (D-077).
  const minAuto = (MIN_AUTOPAY_MINOR as Record<string, bigint | undefined>)[kind];
  const errors = {
    provider: !effectiveProvider ? (mobile ? "Choose the network" : "Choose a provider") : null,
    ref: refLocked ? null : validateRef(kind, ref),
    amount:
      bundlesOn && !variation
        ? "Choose a bundle"
        : amountMinor === null || amountMinor <= 0n
        ? "Enter an amount, e.g. 5000"
        : currency === "NGN" && minAuto && amountMinor < minAuto
          ? `Automatic top-ups start at ${formatMoney(minAuto, "NGN")}`
          : null,
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
  const ok = Object.values(errors).every((e) => !e);
  const show = (e: string | null) => (tried ? e : null);
  const chosen = providers.find((p) => p.id === effectiveProvider);
  const pName = chosen?.name ?? "";

  async function submit(e: FormEvent) {
    e.preventDefault();
    setTried(true);
    setApiError(null);
    if (!ok || amountMinor === null) {
      // Take the person straight to the first thing to fix.
      setTimeout(() => formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(), 0);
      return;
    }
    const now = new Date().toISOString();
    const readings = initial?.readings ?? [];
    setBusy(true);
    try {
    await onSave({
      id: initial?.id ?? newId(),
      kind,
      provider: effectiveProvider,
      ref: ref.trim(),
      nickname: nickname.trim() || `${pName} ${kindLabel(kind).toLowerCase()}`.trim(),
      currency,
      amountMinor: amountMinor.toString(),
      threshold: usage ? thresholdNum : undefined,
      renewDay: usage ? undefined : day,
      ...(kind === "electricity" ? { meterType } : {}),
      weeklyCapMinor: (capMinor ?? amountMinor).toString(),
      status: initial?.status ?? "active",
      readings: usage && currentNum !== null && !onServer ? [...readings, { at: now, value: currentNum }] : readings,
      createdAt: initial?.createdAt ?? now,
      ...(onServer ? { schedule: kind === "subscription" ? ("none" as const) : usage ? ("usage" as const) : ("monthly" as const) } : {}),
      ...(initial?.onServer ? { onServer: true, variationCode: initial.variationCode ?? null } : {}),
    }, { variationCode: bundlesOn ? variation : null });
    } catch (err) {
      setApiError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // ── Choosing the provider (electricity, TV, subscriptions) ──
  if (step === "provider") {
    return (
      <div className="ap-form">
        {onBack && (
          <button type="button" className="ap-back" onClick={onBack}>
            <span aria-hidden="true">←</span> {kindLabel(kind)}
          </button>
        )}
        <h3 className="ap-step-title">{kind === "electricity" ? "Select your distributor" : kind === "tv" ? "Select your provider" : "Select the service"}</h3>
        <ProviderGrid
          kind={kind}
          value={provider}
          onPick={(id) => {
            setProvider(id);
            setStep("details");
          }}
          {...(kind === "electricity" ? { meterType, onMeterType: setMeterType } : {})}
        />
      </div>
    );
  }

  const suggest = mobile && detected && pickedByHand && detected !== effectiveProvider ? providers.find((p) => p.id === detected) : null;

  return (
    <form className="ap-form" onSubmit={submit} noValidate ref={formRef}>
      {onBack && !initial && (
        <button type="button" className="ap-back" onClick={onBack}>
          <span aria-hidden="true">←</span> {kindLabel(kind)}
        </button>
      )}
      {initial && onBack && (
        <button type="button" className="ap-back" onClick={onBack}>
          <span aria-hidden="true">←</span> Back
        </button>
      )}

      {!mobile && chosen && (
        <div className="ap-selected">
          <ProviderLogo kind={kind} id={chosen.id} size={44} />
          <span className="ap-row-main">
            <b>{chosen.full ?? chosen.name}</b>
            <small>{kind === "electricity" ? (meterType === "prepaid" ? "Prepaid meter" : "Postpaid meter") : kindLabel(kind)}</small>
          </span>
          <button type="button" className="ap-link" onClick={() => setStep("provider")}>
            Change
          </button>
        </div>
      )}

      {mobile ? (
        <>
          <div className="ap-field">
            <label htmlFor={phoneId}>Phone number</label>
            <div className="ap-phone" data-invalid={Boolean(show(errors.ref))}>
              {chosen && <ProviderLogo kind={kind} id={chosen.id} size={32} />}
              <input
                id={phoneId}
                inputMode="tel"
                autoComplete="tel"
                value={refLocked ? maskRef(kind, ref) : ref}
                disabled={refLocked}
                onChange={(e) => setRef(e.target.value)}
                placeholder="0803 123 4567"
                aria-invalid={Boolean(show(errors.ref))}
                aria-describedby={show(errors.ref) ? `${phoneId}-msg` : undefined}
              />
            </div>
            {show(errors.ref) && (
              <span id={`${phoneId}-msg`} className="ap-err">
                {show(errors.ref)}
              </span>
            )}
          </div>

          {!refLocked && (
          <fieldset className="ap-field">
            <legend>Network</legend>
            <NetworkPicker
              kind={kind}
              value={effectiveProvider}
              invalid={Boolean(show(errors.provider))}
              onPick={(id) => {
                setProvider(id);
                // Picking the network the number already shows is not an override.
                setPickedByHand(id !== detected);
              }}
            />
            <span className={show(errors.provider) ? "ap-err" : "ap-hint"} role={show(errors.provider) ? "alert" : undefined}>
              {show(errors.provider) ??
                (chosen && !pickedByHand && detected
                  ? `Picked from your number. Moved to another network? Tap yours.`
                  : chosen
                    ? `${chosen.name} selected.`
                    : "Picked for you as you type the number, or tap your network.")}
            </span>
            {suggest && (
              <button
                type="button"
                className="ap-suggest"
                onClick={() => {
                  setProvider(suggest.id);
                  setPickedByHand(false);
                }}
              >
                <ProviderLogo kind={kind} id={suggest.id} size={22} />
                This number looks like {suggest.name}. Use {suggest.name}
              </button>
            )}
          </fieldset>
          )}
        </>
      ) : (
        <Field label={REF_LABEL[kind]} error={show(errors.ref)}>
          {(a) => (
            <input
              {...a}
              inputMode={kind === "subscription" ? "email" : "numeric"}
              autoComplete={kind === "subscription" ? "email" : "off"}
              value={refLocked ? maskRef(kind, ref) : ref}
              disabled={refLocked}
              onChange={(e) => setRef(e.target.value)}
              placeholder={kind === "subscription" ? "you@example.com" : kind === "electricity" ? "45012345678" : "7012345678"}
            />
          )}
        </Field>
      )}

      {meter.state !== "idle" && (
        <p className={meter.state === "error" ? "ap-err" : "ap-hint"} role="status" aria-live="polite">
          {meter.state === "checking" ? "Checking the meter…" : meter.state === "found" ? (
            <span className="ap-meter-ok">
              <b>{meter.found.customerName}</b>
              {meter.found.address ? ` · ${meter.found.address}` : ""}
            </span>
          ) : meter.message}
        </p>
      )}
      {initial?.customerName && (
        <p className="ap-hint">
          Meter in the name of <b>{initial.customerName}</b>
        </p>
      )}

      {bundlesOn ? (
        <BundleList
          network={effectiveProvider}
          state={bundles}
          value={variation}
          invalid={Boolean(show(errors.amount))}
          error={show(errors.amount)}
          onPick={setVariation}
        />
      ) : (
      <div className="ap-field">
        <label htmlFor={amountId}>{usage ? "Each top-up" : kind === "electricity" ? "Each payment" : "Each renewal"}</label>
        <div className="ap-amount" data-invalid={Boolean(show(errors.amount))}>
          <span aria-hidden="true">{sym}</span>
          <input
            id={amountId}
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={currency === "NGN" ? "0" : "0.00"}
            aria-invalid={Boolean(show(errors.amount))}
            aria-describedby={show(errors.amount) ? `${amountId}-msg` : undefined}
          />
        </div>
        {show(errors.amount) && (
          <span id={`${amountId}-msg`} className="ap-err">
            {show(errors.amount)}
          </span>
        )}
        {quick && (
          <div className="ap-quick" role="group" aria-label="Quick amounts">
            {quick.map((n) => (
              <button type="button" key={n} className="ap-quick-btn" data-on={toMinor(amount) === BigInt(n) * 100n} onClick={() => setAmount(String(n))}>
                {formatMoney(BigInt(n) * 100n, "NGN")}
              </button>
            ))}
          </div>
        )}
      </div>
      )}

      <section className="ap-form-section" aria-label={usage ? "When to top up" : kind === "electricity" ? "When it's paid" : "When it renews"}>
        <h4>{usage ? "When to top up" : kind === "electricity" ? "When it's paid" : "When it renews"}</h4>
        {canChoose && (
          <div className="ap-tabs" role="tablist" aria-label="When to pay">
            {(["monthly", "usage"] as const).map((w) => (
              <button key={w} type="button" role="tab" aria-selected={when === w} className="ap-tab" data-on={when === w} onClick={() => setWhen(w)}>
                {w === "monthly" ? "On a day each month" : "When it runs low"}
              </button>
            ))}
          </div>
        )}
        {canChoose && (
          <p className="ap-hint" style={{ margin: 0 }}>
            {when === "monthly"
              ? "Fully automatic: paid on the same day every month."
              : `Tell ConstantUnits what's left (log a reading) or tap "Top up now", and it tops up at your level.`}
          </p>
        )}
        <div className="ap-grid-2">
          {usage ? (
            <Field label={`Top up at (${UNIT[kind]})`} error={show(errors.threshold)}>
              {(a) => <input {...a} inputMode="decimal" value={threshold} onChange={(e) => setThreshold(e.target.value)} />}
            </Field>
          ) : (
            <Field label={kind === "electricity" ? "Pay on day" : "Renews on day"} error={show(errors.day)} hint="1 to 28">
              {(a) => <input {...a} inputMode="numeric" value={renewDay} onChange={(e) => setRenewDay(e.target.value)} />}
            </Field>
          )}
          {usage && onServer ? null : usage ? (
            <Field label={`${initial ? "New reading" : "Left now"} (${UNIT[kind]})`} error={show(errors.current)} hint="Optional">
              {(a) => <input {...a} inputMode="decimal" value={current} onChange={(e) => setCurrent(e.target.value)} />}
            </Field>
          ) : (
            <Field label={`Most per ${kind === "electricity" ? "payment" : "renewal"} (${sym})`} error={show(errors.cap)} hint="Optional">
              {(a) => <input {...a} inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value)} />}
            </Field>
          )}
        </div>
        {usage && (
          <Field
            label={`Weekly cap (${sym}, optional)`}
            error={show(errors.cap)}
            hint="ConstantUnits never spends more than this in a week. Defaults to one top-up."
          >
            {(a) => <input {...a} inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value)} />}
          </Field>
        )}
      </section>

      <Field label="Name (optional)" hint="So you can tell bills apart">
        {(a) => (
          <input
            {...a}
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            placeholder={
              kind === "electricity"
                ? "Home meter"
                : kind === "tv"
                  ? `Living room ${pName || "TV"}`
                  : kind === "subscription"
                    ? (PLAN_HINT[effectiveProvider] ?? "My subscription")
                    : kind === "airtime"
                      ? "My airtime"
                      : "My data"
            }
            maxLength={40}
          />
        )}
      </Field>

      {tried && !ok && (
        <p className="ap-err" role="alert">
          Check the highlighted fields.
        </p>
      )}

      {apiError && (
        <p className="ap-err" role="alert">
          {apiError}
        </p>
      )}

      <button className="btn btn-primary" type="submit" disabled={busy}>
        {busy ? "Saving…" : initial ? "Save changes" : "Save bill"}
      </button>
      {!initial && (
        <p className="ap-fine">
          {onServer
            ? kind === "subscription"
              ? "Saved to your account as a reminder. Paying subscriptions opens later. "
              : `Nothing is paid now. ${kind === "electricity" ? "The meter is checked before it's saved. " : ""}Saved to your account, with the ${REF_LABEL[kind].toLowerCase()} encrypted. `
            : `Nothing is paid now. Before the first payment, ConstantUnits checks the ${REF_LABEL[kind].toLowerCase()} and shows you the name on it. `}
          {feeNote(kind, isFirst)}
        </p>
      )}
    </form>
  );
}

/* ── Data bundles and meter checks (on the account) ─────── */

type BundlesState = { plans: DataPlan[] | null; error: string | null; loading: boolean };

/** The network's bundles at today's prices, from the API (which asks the partner). */
function useBundles(network: string | null): BundlesState {
  const { call } = useServer();
  const [state, setState] = useState<BundlesState>({ plans: null, error: null, loading: false });
  useEffect(() => {
    if (!network) {
      setState({ plans: null, error: null, loading: false });
      return;
    }
    let live = true;
    setState({ plans: null, error: null, loading: true });
    call<DataPlan[]>(`/v1/data-plans?network=${encodeURIComponent(network)}`)
      .then((plans) => live && setState({ plans, error: null, loading: false }))
      .catch((e: Error) => live && setState({ plans: null, error: e.message, loading: false }));
    return () => {
      live = false;
    };
  }, [network, call]);
  return state;
}

const MIN_DATA = (MIN_AUTOPAY_MINOR as Record<string, bigint | undefined>).data ?? 0n;

function BundleList({
  network,
  state,
  value,
  onPick,
  invalid,
  error,
}: {
  network: string;
  state: BundlesState;
  value: string | null;
  onPick: (code: string) => void;
  invalid: boolean;
  error: string | null;
}) {
  const [q, setQ] = useState("");
  const id = useId();
  const plans = state.plans ?? [];
  const shown = q.trim() ? plans.filter((p) => p.name.toLowerCase().includes(q.trim().toLowerCase())) : plans;
  return (
    <fieldset className="ap-field">
      <legend>Bundle</legend>
      {!network ? (
        <span className="ap-hint">Enter the number first; the bundles follow its network.</span>
      ) : state.loading ? (
        <div className="ap-inline-state" role="status">
          <span className="ap-spinner" aria-hidden="true" />
          <span className="ap-muted">Loading today&apos;s bundles…</span>
        </div>
      ) : state.error ? (
        <span className="ap-err">{state.error}</span>
      ) : (
        <>
          {plans.length > 8 && (
            <div className="ap-search">
              <label htmlFor={id} className="sr-only">
                Search bundles
              </label>
              <input id={id} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search, e.g. 1GB or 30 days" autoComplete="off" />
            </div>
          )}
          <div className="ap-plans" role="radiogroup" aria-label="Bundle" data-invalid={invalid || undefined}>
            {shown.map((p) => {
              const price = BigInt(p.amountMinor);
              const tooSmall = price < MIN_DATA;
              return (
                <button
                  key={p.code}
                  type="button"
                  role="radio"
                  aria-checked={value === p.code}
                  className="ap-plan"
                  data-on={value === p.code}
                  disabled={tooSmall}
                  onClick={() => onPick(p.code)}
                >
                  <span>{p.name}</span>
                  <b>{tooSmall ? "From ₦500" : formatMoney(price, "NGN")}</b>
                </button>
              );
            })}
            {shown.length === 0 && <span className="ap-hint">No bundle matches.</span>}
          </div>
        </>
      )}
      {error && <span className="ap-err">{error}</span>}
      <span className="ap-hint">Priced by the network today. If a bundle costs more later than your limit, we ask before paying.</span>
    </fieldset>
  );
}

type MeterState = { state: "idle" } | { state: "checking" } | { state: "found"; found: MeterCheck } | { state: "error"; message: string };

/** Looks the meter up as soon as the number is complete, so the person sees the name on it before saving. */
function useMeterCheck(q: { provider: string; ref: string; meterType: MeterType } | null): MeterState {
  const { call } = useServer();
  const [st, setSt] = useState<MeterState>({ state: "idle" });
  const meter = q ? q.ref.replace(/[\s-]/g, "") : "";
  const ready = Boolean(q && q.provider && /^\d{11,13}$/.test(meter));
  const provider = q?.provider ?? "";
  const meterType = q?.meterType ?? "prepaid";
  useEffect(() => {
    if (!ready) {
      setSt({ state: "idle" });
      return;
    }
    let live = true;
    const t = setTimeout(() => {
      setSt({ state: "checking" });
      call<MeterCheck>("/v1/meters/lookup", { method: "POST", body: { provider, meter, meterType } })
        .then((found) => live && setSt({ state: "found", found }))
        .catch((e: Error) => live && setSt({ state: "error", message: e.message }));
    }, 600);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [ready, provider, meter, meterType, call]);
  return st;
}

/* ── Detail ──────────────────────────────────────────────── */

const ORDER_STATE: Record<ServerOrder["state"], string> = {
  ready: "Starting",
  vending: "In progress",
  token_stored: "Paid",
  notifying: "Paid",
  settled: "Paid",
  failed: "Not paid, nothing taken",
  needs_human: "Being checked",
};

function BillDetail({ line, store, orders, onDelete }: { line: Line; store: Store; orders: ServerOrder[]; onDelete: () => void }) {
  const notify = useNotify();
  const usage = isUsageLine(line);
  const [editing, setEditing] = useState(false);
  const [reading, setReading] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const readingId = useId();
  const t = lineStatus(line, new Date());
  const last = latest(line.readings);
  const value = Number(reading);
  const readingOk = reading.trim() !== "" && Number.isFinite(value) && value >= 0;
  const withToken = orders.find((o) => o.token);

  const run = async (label: string, f: () => Promise<void>, done: string) => {
    setBusy(label);
    try {
      await f();
      notify(done);
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (editing) {
    return (
      <BillForm
        kind={line.kind}
        initial={line}
        onServer={Boolean(line.onServer)}
        onBack={() => setEditing(false)}
        onSave={async (next, extra) => {
          await store.update(next, extra);
          setEditing(false);
          notify("Changes saved");
        }}
      />
    );
  }

  return (
    <div className="ap-detail">
      <div className="ap-detail-top">
        <ProviderLogo kind={line.kind} id={line.provider} size={44} />
        <div>
          <b className="mono">{t.right}</b>
          <small>{t.sub}</small>
        </div>
      </div>

      {line.setupNeeded === "bundle" && (
        <div className="ap-confirm">
          <span className="ap-row-main">
            <b>Choose a bundle to turn this on</b>
            <small>It moved from your phone with an amount, but the network sells data as bundles.</small>
          </span>
          <button className="btn btn-primary btn-sm" onClick={() => setEditing(true)}>
            Choose
          </button>
        </div>
      )}

      {withToken?.token && (
        <section className="ap-token-box" aria-label="Your latest token">
          <small>Latest token · {formatDay(new Date(withToken.createdAt))}</small>
          <b className="mono">{withToken.token}</b>
          <span className="ap-row-main">
            <small>
              {formatMoney(BigInt(withToken.amountMinor), "NGN")}
              {withToken.tokenUnits ? ` · ${withToken.tokenUnits} kWh` : ""}
            </small>
          </span>
          <button
            className="btn btn-ghost btn-sm"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(withToken.token!.replace(/-/g, ""));
                notify("Token copied");
              } catch {
                notify("Couldn't copy. Type it from the screen.");
              }
            }}
          >
            Copy token
          </button>
        </section>
      )}

      <dl className="ap-dl">
        <div>
          <dt>Provider</dt>
          <dd>{providerFull(line)}</dd>
        </div>
        {line.kind === "electricity" && (
          <div>
            <dt>Meter</dt>
            <dd>{line.meterType === "postpaid" ? "Postpaid" : "Prepaid"}</dd>
          </div>
        )}
        <div>
          <dt>{REF_LABEL[line.kind]}</dt>
          <dd>{maskRef(line.kind, line.ref)}</dd>
        </div>
        {line.customerName && (
          <div>
            <dt>Name on it</dt>
            <dd>{line.customerName}</dd>
          </div>
        )}
        {line.kind === "data" && line.onServer && (
          <div>
            <dt>Bundle</dt>
            <dd>{line.planName ?? "Not chosen"}</dd>
          </div>
        )}
        <div>
          <dt>{usage ? "Each top-up" : "Each payment"}</dt>
          <dd>{formatMoney(BigInt(line.amountMinor), line.currency)}</dd>
        </div>
        <div>
          <dt>{usage ? "Tops up at" : "Paid on"}</dt>
          <dd>{usage ? `${line.threshold} ${UNIT[line.kind]}` : `Day ${line.renewDay} of each month`}</dd>
        </div>
        <div>
          <dt>{usage ? "Weekly limit" : "Most per payment"}</dt>
          <dd>{formatMoney(BigInt(line.weeklyCapMinor), line.currency)}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{line.held ? "On hold: we're checking a payment" : line.status === "active" ? "Active" : "Paused"}</dd>
        </div>
      </dl>

      {usage && (
        <form
          className="ap-reading"
          onSubmit={(e) => {
            e.preventDefault();
            if (!readingOk) return;
            void run("reading", () => store.addReading(line, value), line.onServer && line.threshold !== undefined && value <= line.threshold ? "Saved. It's low, so a top-up is on its way." : "Reading saved");
            setReading("");
          }}
        >
          <div className="ap-field" style={{ flex: 1 }}>
            <label htmlFor={readingId}>What&apos;s left now ({UNIT[line.kind]})</label>
            <input
              id={readingId}
              inputMode="decimal"
              value={reading}
              onChange={(e) => setReading(e.target.value)}
              placeholder={last ? `Last: ${last.value.toLocaleString()}` : "What's left now"}
            />
          </div>
          <button className="btn btn-primary btn-sm" type="submit" disabled={!readingOk || busy !== null}>
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

      {orders.length > 0 && (
        <section aria-label="Recent payments">
          <h3 className="ap-section-title">Recent payments</h3>
          <ul className="ap-readings">
            {orders.slice(0, 5).map((o) => (
              <li key={o.id}>
                <span>
                  {formatDay(new Date(o.createdAt))} · {ORDER_STATE[o.state]}
                </span>
                <span className="mono">{formatMoney(BigInt(o.amountMinor), "NGN")}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="ap-actions">
        {usage && line.onServer && line.status === "active" && !line.held && !line.setupNeeded && (
          <button className="btn btn-primary btn-sm" disabled={busy !== null} onClick={() => run("now", () => store.topUpNow(line), "Top-up requested. You'll get a message when it lands.")}>
            {busy === "now" ? "Requesting…" : "Top up now"}
          </button>
        )}
        <button className="btn btn-ghost btn-sm" onClick={() => setEditing(true)} disabled={line.held}>
          Edit
        </button>
        {!line.held && (
          <button
            className="btn btn-ghost btn-sm"
            disabled={busy !== null}
            onClick={() => {
              const next = line.status === "active" ? "paused" : "active";
              void run("pause", () => store.update({ ...line, status: next }), next === "paused" ? "Paused. Nothing will be paid until you resume." : "Resumed");
            }}
          >
            {line.status === "active" ? "Pause" : "Resume"}
          </button>
        )}
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
