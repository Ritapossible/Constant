"use client";

import { usePrivy, useWallets, type User } from "@privy-io/react-auth";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Address } from "viem";

export type WalletState =
  | { status: "ready"; address: Address; embedded: boolean }
  | { status: "creating" }
  | { status: "error"; retry: () => void };

/**
 * The user's address for stables: their Privy embedded wallet, or the wallet
 * they signed in with. If an embedded wallet should exist but doesn't show up
 * (creation failed or was interrupted), create it, and offer a retry on failure.
 */
export function useWalletAddress(user: User): WalletState {
  const { createWallet } = usePrivy();
  const { wallets, ready } = useWallets();
  const embedded = wallets.find((w) => w.walletClientType === "privy");
  const external = user.wallet && user.wallet.walletClientType !== "privy" ? user.wallet : undefined;
  const [failed, setFailed] = useState(false);
  const attempted = useRef(false);

  const create = useCallback(async () => {
    attempted.current = true;
    setFailed(false);
    try {
      await createWallet();
    } catch (e) {
      // "already has an embedded wallet" means it exists and will appear; anything else is a real failure.
      if (!String((e as Error)?.message ?? e).toLowerCase().includes("already")) setFailed(true);
    }
  }, [createWallet]);

  useEffect(() => {
    if (!ready || embedded || external || attempted.current) return;
    // Give automatic creation on login a moment before stepping in.
    const t = setTimeout(create, 4000);
    return () => clearTimeout(t);
  }, [ready, embedded, external, create]);

  if (embedded) return { status: "ready", address: embedded.address as Address, embedded: true };
  if (external) return { status: "ready", address: external.address as Address, embedded: false };
  if (failed) return { status: "error", retry: create };
  return { status: "creating" };
}
