"use client";

import { useWallets, type User } from "@privy-io/react-auth";
import QRCode from "qrcode";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPublicClient, erc20Abi, http, type Address } from "viem";
import { EXPLORER, STABLES, arc, base } from "@/lib/app/chains";
import { formatMoney, formatUnits6 } from "@/lib/app/format";
import type { Plan } from "@/lib/app/store";

const clients = {
  base: createPublicClient({ chain: base, transport: http(process.env.NEXT_PUBLIC_BASE_RPC_URL) }),
  arc: createPublicClient({ chain: arc, transport: http() }),
};

type Balances = Record<string, bigint | null>;

/** The user's own address: the Privy embedded wallet, or the wallet they signed in with. */
function useAddress(user: User): Address | null {
  const { wallets } = useWallets();
  const embedded = wallets.find((w) => w.walletClientType === "privy");
  return ((embedded?.address ?? user.wallet?.address) as Address | undefined) ?? null;
}

export function Money({ user, plan }: { user: User; plan: Plan }) {
  const address = useAddress(user);
  const [balances, setBalances] = useState<Balances>({});
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [qr, setQr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!address) return;
    setLoading(true);
    const results = await Promise.allSettled(
      STABLES.map((t) =>
        clients[t.chain].readContract({ address: t.address, abi: erc20Abi, functionName: "balanceOf", args: [address] }),
      ),
    );
    const next: Balances = {};
    STABLES.forEach((t, i) => {
      const r = results[i];
      next[t.key] = r && r.status === "fulfilled" ? (r.value as bigint) : null;
    });
    setBalances(next);
    setLoading(false);
  }, [address]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!address) return;
    QRCode.toString(address, { type: "svg", margin: 0, color: { dark: "#0a0a0a", light: "#ffffff" } }).then(setQr).catch(() => setQr(null));
  }, [address]);

  const total = useMemo(() => Object.values(balances).reduce<bigint>((s, v) => s + (v ?? 0n), 0n), [balances]);
  const monthlyNgn = plan.lines.filter((l) => l.status === "active" && l.currency === "NGN").reduce((s, l) => s + BigInt(l.amountMinor), 0n);

  return (
    <div className="ap-page">
      <header className="ap-page-head">
        <p className="ap-kicker">Money</p>
        <h1>Add money</h1>
      </header>

      <section className="ap-hero-card" aria-label="Stablecoin balance">
        <span className="ap-hero-label">Stables in your account</span>
        <span className="ap-hero-num">${formatUnits6(total)}</span>
        <div className="ap-hero-row">
          <span>{monthlyNgn > 0n ? `Your bills need ${formatMoney(monthlyNgn, "NGN")} a month` : "Add bills to see what you need each month"}</span>
          <button className="ap-pill-btn" onClick={refresh} disabled={loading || !address}>
            {loading ? "Checking…" : "Refresh"}
          </button>
        </div>
      </section>

      <section className="ap-card" aria-labelledby="bank-title">
        <div className="ap-card-head">
          <h2 id="bank-title">Bank transfer (naira)</h2>
          <span className="ap-chip">Opening soon</span>
        </div>
        <p className="ap-muted">You will get your own account number. Transfers from any Nigerian bank app land in your Constant pots.</p>
      </section>

      <section className="ap-card" aria-labelledby="stables-title">
        <div className="ap-card-head">
          <h2 id="stables-title">Stablecoins</h2>
          <span className="ap-chip ap-chip-dark">Live</span>
        </div>
        {address ? (
          <>
            <p className="ap-muted">This address is yours. Only you can move what is in it.</p>
            <div className="ap-address">
              {qr && <div className="ap-qr" aria-hidden="true" dangerouslySetInnerHTML={{ __html: qr }} />}
              <div className="ap-address-body">
                <code className="mono">{address}</code>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(address);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1800);
                    } catch {
                      /* clipboard blocked */
                    }
                  }}
                >
                  {copied ? "Copied" : "Copy address"}
                </button>
              </div>
            </div>
            <div className="ap-warn" role="note">
              <b>Send only these:</b> USDC or USDT on <b>Base</b>, or USDC on <b>Arc</b>. Other tokens or networks can be lost.
            </div>
            <ul className="ap-list ap-list-tight">
              {STABLES.map((t) => (
                <li key={t.key} className="ap-row">
                  <span className="ap-token">{t.symbol}</span>
                  <span className="ap-row-main">
                    <b>
                      {t.symbol} on {t.chain === "base" ? "Base" : "Arc"}
                    </b>
                    <small>
                      <a href={EXPLORER[t.chain](address)} target="_blank" rel="noreferrer">
                        View on explorer
                      </a>
                    </small>
                  </span>
                  <span className="ap-row-right mono">{balances[t.key] === undefined ? "…" : balances[t.key] === null ? "—" : formatUnits6(balances[t.key]!)}</span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="ap-muted">Setting up your address…</p>
        )}
      </section>
    </div>
  );
}
