"use client";

import type { User } from "@privy-io/react-auth";
import { useMemo } from "react";
import { UNIT, isUsageKind } from "@/lib/app/catalog";
import { formatDay, formatMoney } from "@/lib/app/format";
import { notices, outlook, type Outlook } from "@/lib/app/insights";
import type { Line } from "@/lib/app/store";
import { KindIcon } from "./KindIcon";
import { displayName, type GoTo, type Store } from "./Shell";

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
  const active = store.plan.lines.filter((l) => l.status === "active");
  const totals = useMemo(() => {
    let ngn = 0n;
    let usd = 0n;
    for (const l of active) {
      // Usage lines are counted once a month at their top-up amount, as a planning estimate.
      if (l.currency === "NGN") ngn += BigInt(l.amountMinor);
      else usd += BigInt(l.amountMinor);
    }
    return { ngn, usd };
  }, [active]);
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
        <h1>{displayName(user)}</h1>
      </header>

      <section className="ap-hero-card" aria-label="Monthly plan">
        <span className="ap-hero-label">To stay covered each month</span>
        <span className="ap-hero-num">{formatMoney(totals.ngn, "NGN")}</span>
        {totals.usd > 0n && <span className="ap-hero-sub">+ {formatMoney(totals.usd, "USD")} in subscriptions</span>}
        <div className="ap-hero-row">
          <span>
            {active.length} active {active.length === 1 ? "bill" : "bills"}
          </span>
          <button className="ap-pill-btn" onClick={() => goTo("bills")}>
            Manage bills
          </button>
        </div>
      </section>

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
        {upcoming.length === 0 ? (
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
