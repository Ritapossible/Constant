"use client";

import { useEffect, useState } from "react";
import { LogoMark } from "@/components/Logo";
import { API_URL, type PublicReceipt } from "@/lib/app/api";
import { formatMoney } from "@/lib/app/format";
import { providerName } from "./Cable";

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const bytes = (h: string) => new Uint8Array(h.match(/../g)!.map((x) => parseInt(x, 16)));
const sha256 = async (...parts: Uint8Array[]) => {
  const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    all.set(p, o);
    o += p.length;
  }
  return hex(await crypto.subtle.digest("SHA-256", all));
};

/**
 * Recomputes the receipt's fingerprint from what's on the page and walks the proof to the published root,
 * in the browser. Same construction as packages/chains/src/merkle.ts and receipt.ts.
 */
async function check(r: PublicReceipt): Promise<boolean> {
  if (!r.record || !r.paidAt) return false;
  const data = ["constant.receipt.v1", r.receiptId, r.amountMinor, r.currency, r.provider, r.last4, new Date(r.paidAt).toISOString()].join("|");
  let acc = await sha256(new Uint8Array([0]), new TextEncoder().encode(data));
  if (acc !== r.record.leaf) return false;
  for (const sib of r.record.proof) {
    const [a, b] = acc < sib ? [acc, sib] : [sib, acc];
    acc = await sha256(new Uint8Array([1]), bytes(a), bytes(b));
  }
  return acc === r.record.root;
}

const fmt = (iso: string) =>
  new Intl.DateTimeFormat("en-NG", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Lagos" }).format(new Date(iso));

export function Receipt({ id }: { id: string }) {
  const [r, setR] = useState<PublicReceipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [verified, setVerified] = useState<boolean | null>(null);

  useEffect(() => {
    if (!API_URL) return setError("Receipts aren't available yet.");
    fetch(`${API_URL}/receipts/${encodeURIComponent(id)}`)
      .then(async (res) => {
        if (res.status === 404) throw new Error("We couldn't find this receipt. Check the link.");
        if (!res.ok) throw new Error("Couldn't load the receipt. Try again in a minute.");
        const body = (await res.json()) as PublicReceipt;
        setR(body);
        setVerified(await check(body));
      })
      .catch((e: Error) => setError(e.message));
  }, [id]);

  return (
    <main className="ap-main" style={{ maxWidth: 520, paddingBottom: 48 }}>
      <div className="ap-page">
        <a href="/" className="ap-brand" aria-label="Constant home">
          <LogoMark />
          <span>Constant</span>
        </a>
        {error ? (
          <div className="ap-card" role="alert">
            <p>{error}</p>
          </div>
        ) : !r ? (
          <div className="ap-card ap-inline-state" role="status">
            <span className="ap-spinner" aria-hidden="true" />
            <p className="ap-muted">Loading receipt…</p>
          </div>
        ) : (
          <>
            <header className="ap-page-head">
              <p className="ap-kicker">Receipt</p>
              <h1>{r.status === "paid" ? "Paid" : r.status === "not_paid" ? "Not paid" : "In progress"}</h1>
            </header>
            <section className="ap-card" aria-label="Payment">
              <dl className="ap-dl">
                <div>
                  <dt>Amount</dt>
                  <dd>{formatMoney(BigInt(r.amountMinor), r.currency)}</dd>
                </div>
                <div>
                  <dt>For</dt>
                  <dd>
                    {providerName(r.provider)} ••{r.last4}
                  </dd>
                </div>
                <div>
                  <dt>{r.paidAt ? "Paid" : "Started"}</dt>
                  <dd>{fmt(r.paidAt ?? r.createdAt)}</dd>
                </div>
                <div>
                  <dt>Receipt</dt>
                  <dd className="mono">{r.receiptId}</dd>
                </div>
              </dl>
            </section>
            <section className="ap-card" aria-labelledby="record-title">
              <h2 id="record-title">Public record</h2>
              {r.record ? (
                <>
                  <p className="ap-muted">
                    {verified
                      ? "✓ Checked in your browser: this receipt is part of a record Constant published on a public ledger. Nobody, including Constant, can change it afterwards."
                      : "This receipt doesn't match the published record. Contact Constant support."}
                  </p>
                  <p className="ap-fine">
                    Recorded {r.record.recordedAt ? fmt(r.record.recordedAt) : ""} ·{" "}
                    <a href={r.record.url} target="_blank" rel="noreferrer">
                      View the record
                    </a>
                  </p>
                </>
              ) : (
                <p className="ap-muted">Payments are added to the public record within an hour.</p>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}
