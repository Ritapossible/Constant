"use client";

import { useSmartWallets } from "@privy-io/react-auth/smart-wallets";
import { useCallback, useEffect, useState } from "react";
import { createPublicClient, encodeFunctionData, http, parseAbi, type Address, type Hex } from "viem";
import { arc, base } from "@/lib/app/chains";
import { useServer } from "./Server";
import { useNotify } from "./Toast";

type Symbol = "USDC" | "USDT";
type Network = "base" | "arc";
type Key = "base-usdc" | "base-usdt" | "arc-usdc";

type Permission = { status: string; allowanceUsd: string; periodDays: number; account: string; until: string };

type Status = {
  available: boolean;
  funding: "naira" | "stables";
  tokens: { key: Key; symbol: Symbol; chain: Network; chainId: number; network: string; token: Address; permission: Permission | null }[];
};

type Proposal = {
  manager: Address;
  symbol: Symbol;
  network: Network;
  permission: { account: Address; spender: Address; token: Address; allowance: string; period: number; start: number; end: number; salt: string; extraData: Hex };
  typedData: { domain: { name: string; version: string; chainId: number; verifyingContract: Address }; types: Record<string, { name: string; type: string }[]>; primaryType: "SpendPermission" };
  display: { allowanceUsd: string; periodDays: number; rateNgnPerUsdc: string; until: string };
};

/**
 * Coinbase's Spend Permission Manager (github.com/coinbase/spend-permissions, "Deployments"): the same code at the
 * same address on Base and on Arc (D-070, scripts/arc/deploy-spend-permissions.mjs). Pinned here on purpose:
 * adding an owner gives that address control of the wallet, so the app never adds an address it was merely told
 * about by the server.
 */
const SPEND_PERMISSION_MANAGER = "0xf85210B21cC50302F477BA56686d2019dC9b67Ad";
/** USDC on Arc, from ConstantUnits's build (D-070). Off unless this build says so, whatever the server offers. */
const ARC_ON = process.env.NEXT_PUBLIC_ARC_AUTOPAY === "true";
/** The only tokens and chains the app will ever sign a permission for (D-069, D-070), pinned for the same reason. */
const PINNED: Record<Key, { network: Network; chainId: number; token: string; symbol: Symbol }> = {
  "base-usdc": { network: "base", chainId: base.id, token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", symbol: "USDC" },
  "base-usdt": { network: "base", chainId: base.id, token: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2", symbol: "USDT" },
  "arc-usdc": { network: "arc", chainId: arc.id, token: "0x3600000000000000000000000000000000000000", symbol: "USDC" },
};
const LOGO: Record<Symbol, string> = { USDC: "/tokens/usdc.png", USDT: "/tokens/usdt.png" };
/**
 * ConstantUnits's spender, pinned at build time (from review): even a compromised API can't get a user to sign a
 * permission for someone else's address. The same address on Base and Arc. Unset: the option is hidden.
 */
const PINNED_SPENDER = process.env.NEXT_PUBLIC_SPENDER_ADDRESS ?? "";
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

const WALLET_ABI = parseAbi(["function addOwnerAddress(address owner)", "function isOwnerAddress(address account) view returns (bool)"]);
const readers = {
  base: createPublicClient({ chain: base, transport: http(process.env.NEXT_PUBLIC_BASE_RPC_URL) }),
  arc: createPublicClient({ chain: arc, transport: http() }),
};

/**
 * Pay this bill from stablecoins: USDC and USDT on Base (D-063, D-069), USDC on Arc (D-070). For each one, the
 * user signs one capped permission: ConstantUnits may take up to $X of it every 30 days for this bill, from their own
 * smart account. When the bill is due, the first that can pay all of it pays: Base USDC, Base USDT, then Arc USDC.
 * A dollar screen, so token and network names are shown (D-053).
 */
export function StablesAutopay({ lineId, lineName }: { lineId: string; lineName: string }) {
  const { call, enabled } = useServer();
  const { client } = useSmartWallets();
  const notify = useNotify();
  const [status, setStatus] = useState<Status | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [step, setStep] = useState<{ key: Key; kind: "preparing" | "owner" | "signing" | "saving" | "stopping" } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    call<Status>(`/v1/lines/${lineId}/stables`).then(setStatus).catch(() => setStatus(null));
  }, [call, lineId]);

  const settingUp = status?.tokens.some((t) => t.permission && t.permission.status !== "approved") ?? false;

  useEffect(() => {
    if (!enabled) return;
    load();
    // While a permission is being registered on its chain, check back every few seconds.
    const t = setInterval(() => settingUp && load(), 5000);
    return () => clearInterval(t);
  }, [enabled, load, settingUp]);

  if (!enabled || !status || !status.available || !/^0x[0-9a-fA-F]{40}$/.test(PINNED_SPENDER)) return null;

  const account = client?.account?.address as Address | undefined;
  // Arc rows only when this build turns Arc on; a permission already on Arc always shows, so it can be stopped.
  const tokens = status.tokens.filter((t) => PINNED[t.key] && (t.chain === "base" || ARC_ON || t.permission));
  const on = tokens.filter((t) => t.permission?.status === "approved");
  const label = (t: { symbol: Symbol; network: string }) => `${t.symbol} on ${t.network}`;

  async function start(key: Key) {
    if (!account) return;
    setError(null);
    setStep({ key, kind: "preparing" });
    try {
      const pin = PINNED[key];
      setProposal(await call<Proposal>(`/v1/lines/${lineId}/stables/proposal`, { method: "POST", body: { account, symbol: pin.symbol, network: pin.network } }));
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
    const key = `${proposal.network}-${proposal.symbol.toLowerCase()}` as Key;
    const pin = PINNED[key];
    if (
      !pin ||
      (pin.network === "arc" && !ARC_ON) ||
      !same(proposal.manager, SPEND_PERMISSION_MANAGER) ||
      !same(proposal.typedData.domain.verifyingContract, SPEND_PERMISSION_MANAGER) ||
      proposal.typedData.domain.chainId !== pin.chainId ||
      !same(pm.account, account) ||
      !same(pm.token, pin.token) ||
      !PINNED_SPENDER ||
      !same(pm.spender, PINNED_SPENDER)
    ) {
      setError("This request doesn't look right, so nothing was approved. Please contact ConstantUnits support.");
      return;
    }
    const name = `${pin.symbol} on ${pin.network === "arc" ? "Arc" : "Base"}`;
    try {
      // The wallet acts on the permission's chain. Gas is sponsored.
      setStep({ key, kind: "owner" });
      await client.switchChain({ id: pin.chainId });
      // 1. Once per account and chain: let the Spend Permission Manager act within signed limits.
      const isOwner = await readers[pin.network]
        .readContract({ address: account, abi: WALLET_ABI, functionName: "isOwnerAddress", args: [proposal.manager] })
        .catch(() => false); // not deployed yet on this chain: the first transaction deploys it
      if (!isOwner) {
        await client.sendTransaction({
          calls: [{ to: account, data: encodeFunctionData({ abi: WALLET_ABI, functionName: "addOwnerAddress", args: [proposal.manager] }), value: 0n }],
        });
      }
      // 2. Sign the permission exactly as ConstantUnits proposed it.
      setStep({ key, kind: "signing" });
      const message = { ...pm, allowance: BigInt(pm.allowance), salt: BigInt(pm.salt) };
      const signature = await client.signTypedData({ domain: proposal.typedData.domain, types: proposal.typedData.types, primaryType: "SpendPermission", message } as never);
      // 3. Hand it to ConstantUnits, which checks it and registers it on that chain.
      setStep({ key, kind: "saving" });
      await call(`/v1/lines/${lineId}/stables`, { method: "POST", body: { permission: pm, signature, network: pin.network } });
      setProposal(null);
      notify(`Approved. ${name} is ready for this bill in about a minute.`);
      load();
    } catch (e) {
      const msg = (e as Error).message ?? "";
      setError(/reject|denied|cancel/i.test(msg) ? "Cancelled. Nothing was changed." : msg || "Something went wrong. Nothing was charged.");
    } finally {
      // Back to Base, where the rest of the app reads balances.
      if (pin.network !== "base") await client.switchChain({ id: base.id }).catch(() => undefined);
      setStep(null);
    }
  }

  async function stop(key: Key) {
    const t = tokens.find((x) => x.key === key)!;
    setError(null);
    setStep({ key, kind: "stopping" });
    try {
      await call(`/v1/lines/${lineId}/stables/${t.symbol}?network=${t.chain}`, { method: "DELETE" });
      const left = on.filter((x) => x.key !== key);
      notify(left.length ? `Stopped. This bill still pays from ${left.map(label).join(" or ")}.` : "Stopped. This bill pays from your naira balance again.");
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
          ? `${lineName} is paid from your ${on.map(label).join(" or ")} when it's due, never above the limit you approved.${on.length > 1 ? " They're tried in the order below." : ""} The rest stays yours.`
          : `Hold ${ARC_ON ? "USDC or USDT on Base, or USDC on Arc," : "USDC or USDT on Base"} instead of naira, and this bill is paid from it when it's due. You approve a monthly limit once for each.`}
      </p>

      <ul className="ap-list ap-list-tight">
        {tokens.map((t) => {
          const p = t.permission;
          const mine = step?.key === t.key;
          return (
            <li key={t.key} className="ap-row">
              <span className="ap-token-logo">
                <img src={LOGO[t.symbol]} alt="" width={40} height={40} />
                <img className="ap-token-net" src={`/tokens/${t.chain}.svg`} alt="" width={18} height={18} />
              </span>
              <span className="ap-row-main">
                <b>{t.symbol}</b>
                <small>{p?.status === "approved" ? `Up to $${p.allowanceUsd} / ${p.periodDays} days · ${t.network}` : p ? "Registering, about a minute" : `Off · ${t.network}`}</small>
              </span>
              <span className="ap-row-right">
                {p?.status === "approved" ? (
                  <button className="btn btn-ghost btn-sm" onClick={() => stop(t.key)} disabled={busy}>
                    {mine && step?.kind === "stopping" ? "Stopping…" : "Stop"}
                  </button>
                ) : p ? (
                  <span className="ap-spinner" role="status" aria-label={`Setting up ${label(t)}`} />
                ) : (
                  <button className="btn btn-ghost btn-sm" onClick={() => start(t.key)} disabled={busy || !account || proposal !== null}>
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
            ConstantUnits can take up to{" "}
            <b>
              ${proposal.display.allowanceUsd} {proposal.symbol} every {proposal.display.periodDays} days
            </b>{" "}
            from your account on {proposal.network === "arc" ? "Arc" : "Base"}, only for {lineName}. That covers your naira limit at today&apos;s rate (₦{proposal.display.rateNgnPerUsdc} per{" "}
            {proposal.symbol}) with room for small rate moves. Stop any time.
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
      {!account && <p className="ap-muted">Your ConstantUnits account is being set up. Check back in a moment.</p>}
      {error && (
        <p className="ap-err" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
