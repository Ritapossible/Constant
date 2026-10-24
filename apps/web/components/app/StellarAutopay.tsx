"use client";

import { useCallback, useEffect, useState } from "react";
import { useServer } from "./Server";
import { useNotify } from "./Toast";
import { STELLAR_CONTRACT, STELLAR_NETWORK, useStellar } from "./useStellar";

type LineStatus = { available: false } | { available: true; funding: string; permission: { status: string; capUsd: string; periodDays: number; account: string; until: string } | null };
type Proposal = { requestId: string; payload: string; preimage: string; network: "testnet" | "public"; contract: string; display: { capUsd: string; periodDays: number; rateNgnPerUsdc: string; until: string } };
/** What the app decoded from the bytes it would sign: shown instead of the server's description. */
type Checked = { capUsd: string; periodDays: number; until: string };

/**
 * Pay this bill from USDC on Stellar (D-085, D-089): one signature, a monthly limit the contract enforces, stop any
 * time. The limit shown is read from the authorization itself, after checking it is for the pinned contract, this
 * account and Circle's USDC.
 */
export function StellarAutopay({ lineId, lineName }: { lineId: string; lineName: string }) {
  const { call, enabled } = useServer();
  const notify = useNotify();
  const { status, usable, wallet, sign, verify } = useStellar();
  const [line, setLine] = useState<LineStatus | null>(null);
  const [proposal, setProposal] = useState<(Proposal & { checked: Checked }) | null>(null);
  const [busy, setBusy] = useState<"preparing" | "signing" | "stopping" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    call<LineStatus>(`/v1/lines/${lineId}/stellar`).then(setLine).catch(() => setLine(null));
  }, [call, lineId]);
  const settingUp = line?.available && line.permission && line.permission.status !== "approved";

  useEffect(() => {
    if (!enabled || !usable) return;
    load();
    const t = setInterval(() => settingUp && load(), 5000);
    return () => clearInterval(t);
  }, [enabled, usable, load, settingUp]);

  if (!usable || !status?.available || !status.ready || !status.account || !line?.available) return null;
  const account = status.account;
  const p = line.permission;

  async function prepare() {
    setError(null);
    setBusy("preparing");
    try {
      const pr = await call<Proposal>(`/v1/lines/${lineId}/stellar/proposal`, { method: "POST" });
      const v = await verify();
      const r = v.checkMandatePreimage(pr.preimage, pr.payload, { network: STELLAR_NETWORK, account, contract: STELLAR_CONTRACT, usdcContract: v.pinnedUsdc(STELLAR_NETWORK).contract });
      if (!r.ok) throw new Error(`We stopped before signing: ${r.reason}.`);
      setProposal({ ...pr, checked: { capUsd: v.formatStellarUnits(r.seen.capUnits), periodDays: Math.round(r.seen.periodSecs / 86_400), until: new Date(r.seen.endAt * 1000).toISOString() } });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function approve() {
    if (!proposal || !wallet) return;
    setError(null);
    setBusy("signing");
    try {
      const signature = await sign(wallet, proposal.payload);
      await call(`/v1/lines/${lineId}/stellar`, { method: "POST", body: { requestId: proposal.requestId, signature } });
      setProposal(null);
      notify("Approved. USDC on Stellar is ready for this bill in about a minute.");
      load();
    } catch (e) {
      const msg = (e as Error).message ?? "";
      setError(/reject|denied|cancel/i.test(msg) ? "Cancelled. Nothing was changed." : msg || "Something went wrong. Nothing was charged.");
    } finally {
      setBusy(null);
    }
  }

  async function stop() {
    setError(null);
    setBusy("stopping");
    try {
      await call(`/v1/lines/${lineId}/stellar`, { method: "DELETE" });
      notify("Stopped. ConstantUnits removes the approval on Stellar in a minute.");
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const until = (iso: string) => new Date(iso).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" });

  return (
    <section className="ap-card" aria-labelledby={`stellar-${lineId}`}>
      <div className="ap-card-head">
        <h3 id={`stellar-${lineId}`}>Pay from USDC on Stellar</h3>
        {p?.status === "approved" ? <span className="ap-chip ap-chip-dark">On</span> : p ? <span className="ap-chip">Setting up</span> : null}
      </div>
      <ul className="ap-list ap-list-tight">
        <li className="ap-row">
          <span className="ap-token-logo">
            <img src="/tokens/usdc.png" alt="" width={40} height={40} />
          </span>
          <span className="ap-row-main">
            <b>USDC</b>
            <small>{p?.status === "approved" ? `Up to $${p.capUsd} / ${p.periodDays} days · until ${until(p.until)}` : p ? "Registering on Stellar, about a minute" : "Off · Stellar"}</small>
          </span>
          <span className="ap-row-right">
            {p?.status === "approved" ? (
              <button className="btn btn-ghost btn-sm" onClick={stop} disabled={busy !== null}>
                {busy === "stopping" ? "Stopping…" : "Stop"}
              </button>
            ) : p ? (
              <span className="ap-spinner" role="status" aria-label="Setting up USDC on Stellar" />
            ) : (
              <button className="btn btn-ghost btn-sm" onClick={prepare} disabled={busy !== null || proposal !== null}>
                {busy === "preparing" ? "Getting rate…" : "Turn on"}
              </button>
            )}
          </span>
        </li>
      </ul>
      {proposal && (
        <>
          <div className="ap-warn" role="note">
            ConstantUnits can take up to{" "}
            <b>
              ${proposal.checked.capUsd} USDC every {proposal.checked.periodDays} days
            </b>{" "}
            from your Stellar address, only for {lineName}, until {until(proposal.checked.until)}. That covers your naira limit at today&apos;s rate (₦{proposal.display.rateNgnPerUsdc} per USDC). The limit
            is enforced on Stellar itself, not just by us. Stop any time.
          </div>
          <div className="ap-actions">
            <button className="btn btn-primary btn-sm" onClick={approve} disabled={busy !== null}>
              {busy === "signing" ? "Waiting for your approval…" : "Approve USDC"}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setProposal(null)} disabled={busy !== null}>
              Cancel
            </button>
          </div>
        </>
      )}
      {error && (
        <p className="ap-err" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
