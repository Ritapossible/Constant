"use client";

import { useSmartWallets } from "@privy-io/react-auth/smart-wallets";
import { useCallback, useEffect, useState } from "react";
import { createPublicClient, encodeFunctionData, http, parseAbi, type Address, type Hex } from "viem";
import { base } from "viem/chains";
import { useServer } from "./Server";
import { useNotify } from "./Toast";

type Status = {
  available: boolean;
  funding: "naira" | "usdc_base";
  permission: { status: string; allowanceUsd: string; periodDays: number; account: string; until: string } | null;
};

type Proposal = {
  manager: Address;
  permission: { account: Address; spender: Address; token: Address; allowance: string; period: number; start: number; end: number; salt: string; extraData: Hex };
  typedData: { domain: { name: string; version: string; chainId: number; verifyingContract: Address }; types: Record<string, { name: string; type: string }[]>; primaryType: "SpendPermission" };
  display: { allowanceUsd: string; periodDays: number; rateNgnPerUsdc: string; until: string };
};

/**
 * Coinbase's Spend Permission Manager on Base (github.com/coinbase/spend-permissions, "Deployments").
 * Pinned here on purpose: adding an owner gives that address control of the wallet, so the app never adds
 * an address it was merely told about by the server.
 */
const SPEND_PERMISSION_MANAGER = "0xf85210B21cC50302F477BA56686d2019dC9b67Ad";
const USDC_ON_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

const WALLET_ABI = parseAbi(["function addOwnerAddress(address owner)", "function isOwnerAddress(address account) view returns (bool)"]);
const publicClient = createPublicClient({ chain: base, transport: http(process.env.NEXT_PUBLIC_BASE_RPC_URL) });

/**
 * Pay this bill from USDC on Base (D-063). The user signs one capped permission: Constant may take up to
 * $X every 30 days for this bill, from their own smart account. A dollar screen, so token and network
 * names are shown (D-053).
 */
export function UsdcAutopay({ lineId, lineName }: { lineId: string; lineName: string }) {
  const { call, enabled } = useServer();
  const { client } = useSmartWallets();
  const notify = useNotify();
  const [status, setStatus] = useState<Status | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [step, setStep] = useState<"idle" | "preparing" | "owner" | "signing" | "saving">("idle");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    call<Status>(`/v1/lines/${lineId}/usdc`).then(setStatus).catch(() => setStatus(null));
  }, [call, lineId]);

  useEffect(() => {
    if (!enabled) return;
    load();
    // While the permission is being registered on Base, check back every few seconds.
    const t = setInterval(() => status?.permission && status.permission.status !== "approved" && load(), 5000);
    return () => clearInterval(t);
  }, [enabled, load, status?.permission]);

  if (!enabled || !status || !status.available) return null;

  const account = client?.account?.address as Address | undefined;
  const p = status.permission;

  async function start() {
    if (!account) return;
    setError(null);
    setStep("preparing");
    try {
      setProposal(await call<Proposal>(`/v1/lines/${lineId}/usdc/proposal`, { method: "POST", body: { account } }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStep("idle");
    }
  }

  async function confirm() {
    if (!client || !proposal || !account) return;
    setError(null);
    const pm0 = proposal.permission;
    if (
      !same(proposal.manager, SPEND_PERMISSION_MANAGER) ||
      !same(proposal.typedData.domain.verifyingContract, SPEND_PERMISSION_MANAGER) ||
      proposal.typedData.domain.chainId !== base.id ||
      !same(pm0.account, account) ||
      !same(pm0.token, USDC_ON_BASE)
    ) {
      setError("This request doesn't look right, so nothing was approved. Please contact Constant support.");
      return;
    }
    try {
      // 1. Once per account: let the Spend Permission Manager act within signed limits. Gas is sponsored.
      setStep("owner");
      const isOwner = await publicClient
        .readContract({ address: account, abi: WALLET_ABI, functionName: "isOwnerAddress", args: [proposal.manager] })
        .catch(() => false); // not deployed yet: the first transaction deploys it
      if (!isOwner) {
        await client.sendTransaction({
          calls: [{ to: account, data: encodeFunctionData({ abi: WALLET_ABI, functionName: "addOwnerAddress", args: [proposal.manager] }), value: 0n }],
        });
      }
      // 2. Sign the permission exactly as Constant proposed it.
      setStep("signing");
      const pm = proposal.permission;
      const message = { ...pm, allowance: BigInt(pm.allowance), salt: BigInt(pm.salt) };
      const signature = await client.signTypedData({ domain: proposal.typedData.domain, types: proposal.typedData.types, primaryType: "SpendPermission", message } as never);
      // 3. Hand it to Constant, which checks it and registers it on Base.
      setStep("saving");
      await call(`/v1/lines/${lineId}/usdc`, { method: "POST", body: { permission: pm, signature } });
      setProposal(null);
      notify("Approved. Switching this bill to USDC takes about a minute.");
      load();
    } catch (e) {
      const msg = (e as Error).message ?? "";
      setError(/reject|denied|cancel/i.test(msg) ? "Cancelled. Nothing was changed." : msg || "Something went wrong. Nothing was charged.");
    } finally {
      setStep("idle");
    }
  }

  async function stop() {
    setError(null);
    try {
      await call(`/v1/lines/${lineId}/usdc`, { method: "DELETE" });
      notify("Stopped. This bill pays from your naira balance again.");
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const busy = step !== "idle";

  return (
    <section className="ap-card" aria-labelledby={`usdc-${lineId}`}>
      <div className="ap-card-head">
        <h3 id={`usdc-${lineId}`}>Pay from USDC</h3>
        {p?.status === "approved" ? <span className="ap-chip ap-chip-dark">On</span> : p ? <span className="ap-chip">Setting up</span> : null}
      </div>

      {p?.status === "approved" ? (
        <>
          <p className="ap-muted">
            {lineName} pays from your USDC on Base: up to <b>${p.allowanceUsd}</b> every {p.periodDays} days, never more. The rest of your USDC stays yours.
          </p>
          <button className="btn btn-ghost btn-sm" onClick={stop}>
            Stop paying from USDC
          </button>
        </>
      ) : p ? (
        <div className="ap-inline-state" role="status">
          <span className="ap-spinner" aria-hidden="true" />
          <p className="ap-muted">Registering your approval on Base. This takes about a minute.</p>
        </div>
      ) : proposal ? (
        <>
          <div className="ap-warn" role="note">
            Constant can take up to <b>${proposal.display.allowanceUsd} USDC every {proposal.display.periodDays} days</b> from your account on Base, only for {lineName}. That covers your naira limit at today&apos;s rate (₦
            {proposal.display.rateNgnPerUsdc} per USDC) with room for small rate moves. Stop any time.
          </div>
          <div className="ap-actions">
            <button className="btn btn-primary btn-sm" onClick={confirm} disabled={busy}>
              {step === "owner" ? "Preparing your account…" : step === "signing" ? "Waiting for your approval…" : step === "saving" ? "Saving…" : "Approve"}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setProposal(null)} disabled={busy}>
              Cancel
            </button>
          </div>
        </>
      ) : account ? (
        <>
          <p className="ap-muted">Hold USDC on Base instead of naira, and this bill is paid from it when it&apos;s due. You approve a monthly limit once.</p>
          <button className="btn btn-ghost btn-sm" onClick={start} disabled={busy}>
            {step === "preparing" ? "Getting today's rate…" : "Pay this bill from USDC"}
          </button>
        </>
      ) : (
        <p className="ap-muted">Your Constant account on Base is being set up. Check back in a moment.</p>
      )}
      {error && (
        <p className="ap-err" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
