"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { SmartWalletsProvider } from "@privy-io/react-auth/smart-wallets";
import type { ReactNode } from "react";
import { arc, base } from "@/lib/app/chains";

export const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";

/**
 * Privy gives web2 sign-in (Google, email, phone, passkey) and a self-custodial
 * embedded wallet for anyone without one, used only for stablecoins (D-056).
 */
export function Providers({ children }: { children: ReactNode }) {
  if (!PRIVY_APP_ID) return <>{children}</>;
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        loginMethods: ["google", "email", "sms", "passkey", "wallet"],
        appearance: {
          theme: "light",
          accentColor: "#0a0a0a",
          logo: "/icon.svg",
          landingHeader: "Your Constant account",
          showWalletLoginFirst: false,
          walletChainType: "ethereum-only",
        },
        embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" } },
        defaultChain: base,
        supportedChains: [base, arc],
        legal: { privacyPolicyUrl: "/privacy" },
      }}
    >
      {/* Smart wallets (Coinbase Smart Wallet on Base) let a bill be paid from USDC within a signed limit (D-063).
          Turned on in the Privy dashboard; without that, the client is simply absent and the option is hidden. */}
      <SmartWalletsProvider>{children}</SmartWalletsProvider>
    </PrivyProvider>
  );
}
