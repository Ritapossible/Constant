"use client";

import { useEffect, useState } from "react";
import type { Stables } from "@/lib/app/api";
import { formatDay } from "@/lib/app/format";
import { useServer } from "./Server";

/** What arrived at the user's addresses, as seen by the server's indexer (D-060). Dollar screen only (D-053). */
export function StableDeposits() {
  const { enabled, call } = useServer();
  const [data, setData] = useState<Stables | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const load = () => call<Stables>("/v1/stables").then((d) => live && setData(d)).catch(() => undefined);
    load();
    const t = setInterval(load, 30_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [enabled, call]);

  if (!enabled || !data) return null;
  return (
    <section aria-labelledby="deposits-title">
      <h3 id="deposits-title" className="ap-section-title">
        Recent deposits
      </h3>
      {data.deposits.length === 0 ? (
        <p className="ap-muted">Nothing yet. Deposits show here within a minute of arriving.</p>
      ) : (
        <ul className="ap-list ap-list-tight">
          {data.deposits.slice(0, 8).map((x) => (
            <li key={x.id} className="ap-row">
              <span className="ap-row-main">
                <b>{x.status === "accepted" ? `${x.symbol} on ${x.network}` : `Unsupported token on ${x.network}`}</b>
                <small>
                  {formatDay(new Date(x.at))} ·{" "}
                  <a href={x.txUrl} target="_blank" rel="noreferrer">
                    View transaction
                  </a>
                </small>
              </span>
              <span className="ap-row-right mono">{x.status === "accepted" ? `+${x.amount}` : "Not usable"}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
