"use client";

import type { User } from "@privy-io/react-auth";
import { useMemo } from "react";
import { UNIT, isUsageKind } from "@/lib/app/catalog";
import { formatDay, formatMoney } from "@/lib/app/format";
import { notices, outlook, type Outlook } from "@/lib/app/insights";
import type { Line } from "@/lib/app/store";
import { cableStatus } from "./Cable";
import { KindIcon } from "./KindIcon";
import { useServer } from "./Server";
import { displayName, signInMethods, type GoTo, type Store } from "./Shell";

function greeting(now: Date) {
  const h = Number(new Intl.DateTimeFormat("en-NG", { hour: "numeric", hour12: false, timeZone: "Africa/Lagos" }).format(now));
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export function outlookText(line: Line, o: Outlook): { right: string; sub: string } {
  const unit = UNIT[line.kind];
  switch (o.kind) {
    case "renewal":
      return { right: formatDay(o.date), sub: "renews" };
    case "needs_reading":
      return { right: "Add reading", sub: "to start the forecast" };
    case "learning":
      return { right: `${o.remaining.toLocaleString()} ${unit}`, sub: "still learning your usage" };
    case "steady":
      return { right: `${o.remaining.toLocaleString()} ${unit}`, sub: "steady" };
    case "forecast":
      return {
        right: `${o.remaining.toLocaleString()} ${unit}`,
        sub: o.confident ? `reaches your line about ${formatDay(o.likely)}` : `about ${formatDay(o.likely)}, from few readings`,
      };
  }
}

export function Home({ user, store, goTo }: { user: User; store: Store; goTo: GoTo }) {
  const now = useMemo(() => new Date(), []);
  const server = useServer();
  const serverLines = useMemo(() => (server.me?.lines ?? []).filter((l) => l.status !== "cancelled"), [server.me]);
  const serverActive = serverLines.filter((l) => l.status === "active");
  const active = store.plan.lines.filter((l) => l.status === "active");
  const totals = useMemo(() => {
    let ngn = 0n;
    let usd = 0n;
    for (const l of active) {
      // Usage lines are counted once a month at their top-up amount, as a planning estimate.
      if (l.currency === "NGN") ngn += BigInt(l.amountMinor);
      else usd += BigInt(l.amountMinor);
    }
    // Server cable bills count at their limit, which starts at the provider's price.
    for (const l of serverActive) ngn += BigInt(l.capMinor);
    return { ngn, usd };
  }, [active, serverActive]);
  const heads = useMemo(() => notices(store.plan.lines, now), [store.plan.lines, now]);
  const upcoming = useMemo(
    () =>
      active
        .map((l) => ({ l, o: outlook(l, now) }))
        .sort((a, b) => sortKey(a.o) - sortKey(b.o)),
    [active, now],
  );

  return (
    <div className="ap-page">
      <header className="ap-page-head">
        <p className="ap-kicker">{greeting(now)}</p>
        <h1>{displayName(user, server.me?.user.displayName ?? store.plan.name)}</h1>
      </header>

      <section className="ap-hero-card" aria-label="Monthly plan">
        <span className="ap-hero-label">To stay covered each month</span>
        <span className="ap-hero-num">{formatMoney(totals.ngn, "NGN")}</span>
        {totals.usd > 0n && <span className="ap-hero-sub">+ {formatMoney(totals.usd, "USD")} in subscriptions</span>}
        <div className="ap-hero-row">
          <span>
            {active.length + serverActive.length} active {active.length + serverActive.length === 1 ? "bill" : "bills"}
          </span>
          <button className="ap-pill-btn" onClick={() => goTo("bills")}>
            Manage bills
          </button>
        </div>
      </section>

      <Checklist user={user} store={store} goTo={goTo} />

      {heads.length > 0 && (
        <section aria-labelledby="heads-title">
          <h2 id="heads-title" className="ap-section-title">
            Heads-up
          </h2>
          <div className="ap-stack">
            {heads.map((n) => (
              <div key={n.lineId + n.title} className="ap-notice" data-tone={n.tone}>
                <span className="ap-notice-dot" />
                <span>
                  <b>{n.title}</b>
                  <small>{n.body}</small>
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section aria-labelledby="up-title">
        <h2 id="up-title" className="ap-section-title">
          Covered until
        </h2>
        {upcoming.length === 0 && serverLines.length === 0 ? (
          <div className="ap-empty">
            <p>
              <b>Nothing to keep paid yet.</b>
              <br />
              Add your data, meter, decoder or subscription.
            </p>
            <button className="btn btn-primary btn-sm" onClick={() => goTo("bills")}>
              Add a bill
            </button>
          </div>
        ) : (
          <ul className="ap-list">
            {[...serverLines]
              .sort((a, b) => (a.nextRunAt ?? "9").localeCompare(b.nextRunAt ?? "9"))
              .map((l) => {
                const t = cableStatus(l);
                return (
                  <li key={l.id} className="ap-row">
                    <KindIcon kind="tv" />
                    <span className="ap-row-main">
                      <b>{l.nickname}</b>
                      <small>{t.sub}</small>
                    </span>
                    <span className="ap-row-right mono">{t.right}</span>
                  </li>
                );
              })}
            {upcoming.map(({ l, o }) => {
              const t = outlookText(l, o);
              return (
                <li key={l.id} className="ap-row">
                  <KindIcon kind={l.kind} />
                  <span className="ap-row-main">
                    <b>{l.nickname}</b>
                    <small>{t.sub}</small>
                  </span>
                  <span className="ap-row-right mono">{t.right}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {store.plan.lines.some((l) => isUsageKind(l.kind)) && (
        <p className="ap-fine">Forecasts come from your own readings and only show a date once there is enough history.</p>
      )}
    </div>
  );
}

function sortKey(o: Outlook): number {
  if (o.kind === "renewal") return o.date.getTime();
  if (o.kind === "forecast") return o.likely.getTime();
  return Number.MAX_SAFE_INTEGER - (o.kind === "needs_reading" ? 1 : 0);
}

/**
 * First-run steps, in the order that gets a bill paid. A step that needs an earlier one stays locked,
 * and recovery counts only real sign-in methods, not the wallet created at sign-in.
 */
function Checklist({ user, store, goTo }: { user: User; store: Store; goTo: GoTo }) {
  const server = useServer();
  const lines = store.plan.lines;
  const serverCount = server.me?.lines.length ?? 0;
  const hasBill = lines.length > 0 || serverCount > 0;
  const usage = lines.filter((l) => isUsageKind(l.kind));
  const steps: { done: boolean; locked?: boolean; label: string; sub: string; to: "bills" | "account" }[] = [
    { done: hasBill, label: "Add your first bill", sub: "Data, light, cable or a subscription", to: "bills" },
  ];
  // Cable and subscriptions have nothing to read; the reading step is only for data, airtime and light.
  if (!hasBill || usage.length > 0) {
    steps.push({
      done: usage.some((l) => l.readings.length > 0),
      locked: !hasBill,
      label: "Log a reading",
      sub: hasBill ? "What's left on your data or meter starts the forecast" : "Unlocks after you add a bill",
      to: "bills",
    });
  }
  steps.push({ done: signInMethods(user) > 1, label: "Add a second way to sign in", sub: "So you never get locked out", to: "account" });
  const left = steps.filter((s) => !s.done).length;
  if (left === 0) return null;
  return (
    <section className="ap-card" aria-labelledby="start-title">
      <div className="ap-card-head">
        <h2 id="start-title">Get set up</h2>
        <span className="ap-chip">
          {steps.length - left} of {steps.length} done
        </span>
      </div>
      <ol className="ap-checklist">
        {steps.map((s) => (
          <li key={s.label} data-done={s.done} data-locked={s.locked ?? false}>
            <button
              onClick={() => goTo(s.to)}
              disabled={s.done || s.locked}
              aria-label={s.done ? `${s.label}, done` : s.locked ? `${s.label}, after you add a bill` : s.label}
            >
              <span className="ap-check" aria-hidden="true">
                {s.done && (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m5 12.5 4.5 4.5L19 7.5" />
                  </svg>
                )}
              </span>
              <span className="ap-row-main">
                <b>{s.label}</b>
                <small>{s.sub}</small>
              </span>
              {!s.done && !s.locked && <span aria-hidden="true">→</span>}
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
