"use client";

import { useId, useMemo, useState } from "react";
import { PROVIDERS, type Kind, type MeterType } from "@/lib/app/catalog";
import { ProviderLogo } from "./ProviderLogo";

/**
 * Choosing who provides a bill: a searchable grid of logo tiles (electricity, TV, subscriptions), with the meter
 * type as tabs for electricity. Unavailable providers show, marked "Soon", so people see what's coming.
 */
export function ProviderGrid({
  kind,
  value,
  onPick,
  meterType,
  onMeterType,
}: {
  kind: Kind;
  value?: string;
  onPick: (id: string) => void;
  meterType?: MeterType;
  onMeterType?: (t: MeterType) => void;
}) {
  const [q, setQ] = useState("");
  const searchId = useId();
  const all = PROVIDERS[kind];
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return all;
    return all.filter((p) => `${p.name} ${p.full ?? ""} ${p.id}`.toLowerCase().includes(t));
  }, [all, q]);

  return (
    <div className="ap-picker">
      {all.length > 6 && (
        <div className="ap-search">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <label htmlFor={searchId} className="sr-only">
            Search
          </label>
          <input id={searchId} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={kind === "electricity" ? "Search by city or company" : "Search"} autoComplete="off" />
        </div>
      )}

      {onMeterType && (
        <div className="ap-tabs" role="tablist" aria-label="Meter type">
          {(["prepaid", "postpaid"] as const).map((t) => (
            <button key={t} type="button" role="tab" aria-selected={meterType === t} className="ap-tab" data-on={meterType === t} onClick={() => onMeterType(t)}>
              {t === "prepaid" ? "Prepaid" : "Postpaid"}
            </button>
          ))}
        </div>
      )}

      {shown.length === 0 ? (
        <p className="ap-muted ap-picker-empty">No match for “{q.trim()}”.</p>
      ) : (
        <div className="ap-provider-grid" role="radiogroup" aria-label="Provider">
          {shown.map((p) => (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={value === p.id}
              aria-label={`${p.full ?? p.name}${p.available ? "" : ", coming soon"}`}
              className="ap-provider-card"
              data-on={value === p.id}
              disabled={!p.available}
              onClick={() => onPick(p.id)}
            >
              <ProviderLogo kind={kind} id={p.id} size={56} />
              <b>{p.name}</b>
              {!p.available && <small>Soon</small>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Choosing a mobile network: a list with logos, like a phone's own picker. */
export function NetworkList({ kind, value, onPick }: { kind: "airtime" | "data"; value?: string; onPick: (id: string) => void }) {
  return (
    <ul className="ap-list ap-network-list" role="radiogroup" aria-label="Network">
      {PROVIDERS[kind].map((p) => (
        <li key={p.id}>
          <button type="button" role="radio" aria-checked={value === p.id} className="ap-row ap-row-btn" disabled={!p.available} onClick={() => onPick(p.id)}>
            <ProviderLogo kind={kind} id={p.id} size={40} />
            <span className="ap-row-main">
              <b>{p.name}</b>
              {p.full && <small>{p.full}</small>}
            </span>
            <span className="ap-row-right" aria-hidden="true">
              {value === p.id ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m5 12 5 5 9-10" />
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m9 6 6 6-6 6" />
                </svg>
              )}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
