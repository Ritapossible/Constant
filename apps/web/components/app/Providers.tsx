"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { SmartWalletsProvider } from "@privy-io/react-auth/smart-wallets";
import type { ReactNode } from "react";
import { arc, base } from "@/lib/app/chains";

export const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";

/**
 * Phone sign-in. Off: Privy sends SMS codes only to the US and Canada on its standard plans; Nigerian numbers need
 * its Scale plan with our own Twilio (docs.privy.io, "Setting up SMS or WhatsApp login"). Turn on with
 * NEXT_PUBLIC_SMS_LOGIN=true once that's set up and SMS is enabled in the Privy dashboard.
 */
export const SMS_LOGIN = process.env.NEXT_PUBLIC_SMS_LOGIN === "true";

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
        loginMethods: SMS_LOGIN ? ["google", "email", "sms", "passkey", "wallet"] : ["google", "email", "passkey", "wallet"],
        // Phone entry starts on Nigeria (+234) when phone sign-in is on.
        intl: { defaultCountry: "NG" },
        appearance: {
          theme: "light",
          accentColor: "#0a0a0a",
          logo: "/icon.svg",
          landingHeader: "Your ConstantUnits account",
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
