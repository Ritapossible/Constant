"use client";

import { useSmartWallets } from "@privy-io/react-auth/smart-wallets";
import { useCallback, useEffect, useState } from "react";
import { createPublicClient, encodeFunctionData, http, parseAbi, type Address, type Hex } from "viem";
import { base } from "viem/chains";
import { useServer } from "./Server";
import { useNotify } from "./Toast";

type Symbol = "USDC" | "USDT";

type Permission = { status: string; allowanceUsd: string; periodDays: number; account: string; until: string };

type Status = {
  available: boolean;
  funding: "naira" | "stables";
  tokens: { symbol: Symbol; network: string; token: Address; permission: Permission | null }[];
};

type Proposal = {
  manager: Address;
  symbol: Symbol;
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
/** The only tokens the app will ever sign a permission for (D-069), pinned for the same reason. */
const TOKENS_ON_BASE: Record<Symbol, string> = {
  USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  USDT: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2",
};
const LOGO: Record<Symbol, string> = { USDC: "/tokens/usdc.png", USDT: "/tokens/usdt.png" };
/**
 * Constant's spender, pinned at build time (from review): even a compromised API can't get a user to sign a
 * permission for someone else's address. Unset: the option is hidden.
 */
const PINNED_SPENDER = process.env.NEXT_PUBLIC_SPENDER_ADDRESS ?? "";
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

const WALLET_ABI = parseAbi(["function addOwnerAddress(address owner)", "function isOwnerAddress(address account) view returns (bool)"]);
const publicClient = createPublicClient({ chain: base, transport: http(process.env.NEXT_PUBLIC_BASE_RPC_URL) });

/**
 * Pay this bill from stablecoins on Base: USDC (D-063) and USDT (D-069). For each token, the user signs one
 * capped permission: Constant may take up to $X of it every 30 days for this bill, from their own smart account.
 * When the bill is due, the first token that can pay all of it pays, USDC first. A dollar screen, so token and
 * network names are shown (D-053).
 */
export function StablesAutopay({ lineId, lineName }: { lineId: string; lineName: string }) {
  const { call, enabled } = useServer();
  const { client } = useSmartWallets();
  const notify = useNotify();
  const [status, setStatus] = useState<Status | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [step, setStep] = useState<{ symbol: Symbol; kind: "preparing" | "owner" | "signing" | "saving" | "stopping" } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    call<Status>(`/v1/lines/${lineId}/stables`).then(setStatus).catch(() => setStatus(null));
  }, [call, lineId]);

  const settingUp = status?.tokens.some((t) => t.permission && t.permission.status !== "approved") ?? false;

  useEffect(() => {
    if (!enabled) return;
    load();
    // While a permission is being registered on Base, check back every few seconds.
    const t = setInterval(() => settingUp && load(), 5000);
    return () => clearInterval(t);
  }, [enabled, load, settingUp]);

  if (!enabled || !status || !status.available || !/^0x[0-9a-fA-F]{40}$/.test(PINNED_SPENDER)) return null;

  const account = client?.account?.address as Address | undefined;
  const on = status.tokens.filter((t) => t.permission?.status === "approved");

  async function start(symbol: Symbol) {
    if (!account) return;
    setError(null);
    setStep({ symbol, kind: "preparing" });
    try {
      setProposal(await call<Proposal>(`/v1/lines/${lineId}/stables/proposal`, { method: "POST", body: { account, symbol } }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStep(null);
    }
  }

  async function confirm() {
    if (!client || !proposal || !account) return;
    setError(null);
    const pm = proposal.permission;
    const pinnedToken = TOKENS_ON_BASE[proposal.symbol];
    if (
      !pinnedToken ||
      !same(proposal.manager, SPEND_PERMISSION_MANAGER) ||
      !same(proposal.typedData.domain.verifyingContract, SPEND_PERMISSION_MANAGER) ||
      proposal.typedData.domain.chainId !== base.id ||
      !same(pm.account, account) ||
      !same(pm.token, pinnedToken) ||
      !PINNED_SPENDER ||
      !same(pm.spender, PINNED_SPENDER)
    ) {
      setError("This request doesn't look right, so nothing was approved. Please contact Constant support.");
      return;
    }
    const symbol = proposal.symbol;
    try {
      // 1. Once per account: let the Spend Permission Manager act within signed limits. Gas is sponsored.
      setStep({ symbol, kind: "owner" });
      const isOwner = await publicClient
        .readContract({ address: account, abi: WALLET_ABI, functionName: "isOwnerAddress", args: [proposal.manager] })
        .catch(() => false); // not deployed yet: the first transaction deploys it
      if (!isOwner) {
        await client.sendTransaction({
          calls: [{ to: account, data: encodeFunctionData({ abi: WALLET_ABI, functionName: "addOwnerAddress", args: [proposal.manager] }), value: 0n }],
        });
      }
      // 2. Sign the permission exactly as Constant proposed it.
      setStep({ symbol, kind: "signing" });
      const message = { ...pm, allowance: BigInt(pm.allowance), salt: BigInt(pm.salt) };
      const signature = await client.signTypedData({ domain: proposal.typedData.domain, types: proposal.typedData.types, primaryType: "SpendPermission", message } as never);
      // 3. Hand it to Constant, which checks it and registers it on Base.
      setStep({ symbol, kind: "saving" });
      await call(`/v1/lines/${lineId}/stables`, { method: "POST", body: { permission: pm, signature } });
      setProposal(null);
      notify(`Approved. ${symbol} is ready for this bill in about a minute.`);
      load();
    } catch (e) {
      const msg = (e as Error).message ?? "";
      setError(/reject|denied|cancel/i.test(msg) ? "Cancelled. Nothing was changed." : msg || "Something went wrong. Nothing was charged.");
    } finally {
      setStep(null);
    }
  }

  async function stop(symbol: Symbol) {
    setError(null);
    setStep({ symbol, kind: "stopping" });
    try {
      await call(`/v1/lines/${lineId}/stables/${symbol}`, { method: "DELETE" });
      const left = on.filter((t) => t.symbol !== symbol);
      notify(left.length ? `Stopped. This bill still pays from ${left.map((t) => t.symbol).join(" and ")}.` : "Stopped. This bill pays from your naira balance again.");
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStep(null);
    }
  }

  const busy = step !== null;

  return (
    <section className="ap-card" aria-labelledby={`stables-${lineId}`}>
      <div className="ap-card-head">
        <h3 id={`stables-${lineId}`}>Pay from stablecoins</h3>
        {on.length ? <span className="ap-chip ap-chip-dark">On</span> : settingUp ? <span className="ap-chip">Setting up</span> : null}
      </div>
      <p className="ap-muted">
        {on.length
          ? `${lineName} is paid from your ${on.map((t) => t.symbol).join(" or ")} on Base when it's due, never above the limit you approved.${on.length > 1 ? " USDC is used first." : ""} The rest stays yours.`
          : "Hold USDC or USDT on Base instead of naira, and this bill is paid from it when it's due. You approve a monthly limit once for each."}
      </p>

      <ul className="ap-list ap-list-tight">
        {status.tokens.map((t) => {
          const p = t.permission;
          const mine = step?.symbol === t.symbol;
          return (
            <li key={t.symbol} className="ap-row">
              <span className="ap-token-logo">
                <img src={LOGO[t.symbol]} alt="" width={40} height={40} />
                <img className="ap-token-net" src="/tokens/base.svg" alt="" width={18} height={18} />
              </span>
              <span className="ap-row-main">
                <b>{t.symbol}</b>
                <small>
                  {p?.status === "approved" ? `Up to $${p.allowanceUsd} / ${p.periodDays} days` : p ? "Registering, about a minute" : `Off · ${t.network}`}
                </small>
              </span>
              <span className="ap-row-right">
                {p?.status === "approved" ? (
                  <button className="btn btn-ghost btn-sm" onClick={() => stop(t.symbol)} disabled={busy}>
                    {mine && step?.kind === "stopping" ? "Stopping…" : "Stop"}
                  </button>
                ) : p ? (
                  <span className="ap-spinner" role="status" aria-label={`Setting up ${t.symbol}`} />
                ) : (
                  <button className="btn btn-ghost btn-sm" onClick={() => start(t.symbol)} disabled={busy || !account || proposal !== null}>
                    {mine && step?.kind === "preparing" ? "Getting rate…" : "Turn on"}
                  </button>
                )}
              </span>
            </li>
          );
        })}
      </ul>

      {proposal && (
        <>
          <div className="ap-warn" role="note">
            Constant can take up to{" "}
            <b>
              ${proposal.display.allowanceUsd} {proposal.symbol} every {proposal.display.periodDays} days
            </b>{" "}
            from your account on Base, only for {lineName}. That covers your naira limit at today&apos;s rate (₦{proposal.display.rateNgnPerUsdc} per {proposal.symbol}) with room for small rate
            moves. Stop any time.
          </div>
          <div className="ap-actions">
            <button className="btn btn-primary btn-sm" onClick={confirm} disabled={busy}>
              {step?.kind === "owner" ? "Preparing your account…" : step?.kind === "signing" ? "Waiting for your approval…" : step?.kind === "saving" ? "Saving…" : `Approve ${proposal.symbol}`}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setProposal(null)} disabled={busy}>
              Cancel
            </button>
          </div>
        </>
      )}
      {!account && <p className="ap-muted">Your Constant account on Base is being set up. Check back in a moment.</p>}
      {error && (
        <p className="ap-err" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
