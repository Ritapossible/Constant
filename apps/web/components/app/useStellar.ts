"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useCreateWallet, useSignRawHash } from "@privy-io/react-auth/extended-chains";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useServer } from "./Server";

/**
 * USDC on Stellar (D-085, D-089). The user's Stellar account is a Privy wallet made with their sign-in: no extension,
 * no seed phrase, and no XLM (ConstantUnits sponsors the account and pays every fee). Every signature is over bytes
 * the app has decoded and checked first (@constant/chains/verify), against values pinned in this build.
 */

/** Pinned at build time, like the Base spender: a compromised API can't point the app at another contract. */
export const STELLAR_NETWORK: "testnet" | "public" = process.env.NEXT_PUBLIC_STELLAR_NETWORK === "public" ? "public" : "testnet";
export const STELLAR_CONTRACT = process.env.NEXT_PUBLIC_STELLAR_MANDATE_CONTRACT ?? "";
export const STELLAR_ON = /^C[A-Z2-7]{55}$/.test(STELLAR_CONTRACT);
export const STELLAR_EXPLORER = `https://stellar.expert/explorer/${STELLAR_NETWORK === "public" ? "public" : "testnet"}`;

export type StellarStatus =
  | { available: false }
  | { available: true; network: "testnet" | "public"; account: string | null; ready: boolean; usdc: string | null; contract: string; contractUrl: string };

/** The checker, loaded only when a signature is about to happen (it brings the Stellar SDK). */
const verify = () => import("@constant/chains/verify");

const strip0x = (h: string) => h.replace(/^0x/, "").toLowerCase();

export function useStellar() {
  const { user } = usePrivy();
  const { call, enabled } = useServer();
  const { createWallet } = useCreateWallet();
  const { signRawHash } = useSignRawHash();
  const [status, setStatus] = useState<StellarStatus | null>(null);

  const wallet = useMemo(() => {
    const w = (user?.linkedAccounts ?? []).find((a) => a.type === "wallet" && (a as { chainType?: string }).chainType === "stellar") as { address: string } | undefined;
    return w?.address ?? null;
  }, [user?.linkedAccounts]);

  const load = useCallback(async () => {
    if (!enabled || !STELLAR_ON) return;
    try {
      setStatus(await call<StellarStatus>("/v1/stellar"));
    } catch {
      setStatus({ available: false });
    }
  }, [call, enabled]);

  useEffect(() => {
    load();
  }, [load]);

  // The server must name the same contract this build pins; otherwise the feature stays hidden.
  const usable = STELLAR_ON && status?.available === true && status.contract === STELLAR_CONTRACT;

  /** Signs 32 bytes with the user's Stellar wallet; the caller has already checked what they mean. */
  const sign = useCallback(
    async (address: string, payloadHex: string) => {
      const { signature } = await signRawHash({ address, chainType: "stellar", hash: `0x${strip0x(payloadHex)}` });
      return strip0x(signature);
    },
    [signRawHash],
  );

  /** The user's Stellar account (G…), making the Privy wallet if there isn't one yet. */
  const ensureWallet = useCallback(async () => {
    const v = await verify();
    if (wallet) {
      const acct = v.toStellarAccount(wallet);
      if (!acct) throw new Error("Your Stellar wallet address isn't valid.");
      return { privy: wallet, account: acct };
    }
    const made = await createWallet({ chainType: "stellar" });
    const acct = v.toStellarAccount(made.wallet.address);
    if (!acct) throw new Error("Your Stellar wallet address isn't valid.");
    return { privy: made.wallet.address, account: acct };
  }, [wallet, createWallet]);

  /** One tap: make the wallet, prove it's yours, and open it for USDC. Each step is checked before it's signed. */
  const setUp = useCallback(
    async (onStep: (s: "wallet" | "link" | "open") => void) => {
      const v = await verify();
      onStep("wallet");
      const w = await ensureWallet();
      if (status?.available && status.account !== w.account) {
        onStep("link");
        const ch = await call<{ requestId: string; message: string; payload: string }>("/v1/stellar/link/challenge", { method: "POST", body: { account: w.account } });
        const bad = v.checkLinkMessage(ch.message, w.account, ch.payload);
        if (bad) throw new Error(`We stopped before signing: ${bad}.`);
        await call("/v1/stellar/link", { method: "POST", body: { requestId: ch.requestId, signature: await sign(w.privy, ch.payload) } });
      }
      onStep("open");
      const ob = await call<{ ready: true } | { ready: false; requestId: string; xdr: string; hash: string }>("/v1/stellar/onboarding", { method: "POST" });
      if (!ob.ready) {
        const bad = v.checkOnboarding(ob.xdr, ob.hash, { network: STELLAR_NETWORK, account: w.account, usdcIssuer: v.pinnedUsdc(STELLAR_NETWORK).issuer });
        if (bad) throw new Error(`We stopped before signing: ${bad}.`);
        await call("/v1/stellar/onboarding/submit", { method: "POST", body: { requestId: ob.requestId, signature: await sign(w.privy, ob.hash) } });
      }
      await load();
    },
    [ensureWallet, status, call, sign, load],
  );

  return { status, usable, wallet, load, sign, setUp, verify };
}
