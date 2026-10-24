"use client";

import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { useNotify } from "./Toast";
import { STELLAR_EXPLORER, STELLAR_NETWORK, useStellar } from "./useStellar";

const STEP = { wallet: "Making your Stellar address…", link: "Confirming it's yours…", open: "Opening it for USDC…" } as const;

/**
 * USDC on Stellar (D-089), on the Money screen. One tap makes the address, proves it's the user's and opens it for
 * USDC, ConstantUnits paying every reserve and fee. A dollar screen, so the network and token are named (D-053).
 */
export function StellarWallet() {
  const notify = useNotify();
  const { status, usable, load, setUp } = useStellar();
  const [step, setStep] = useState<keyof typeof STEP | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const account = status?.available ? status.account : null;
  const ready = status?.available ? status.ready : false;

  useEffect(() => {
    if (!account || !ready) return;
    QRCode.toString(account, { type: "svg", margin: 0, color: { dark: "#0a0a0a", light: "#ffffff" } }).then(setQr).catch(() => setQr(null));
  }, [account, ready]);

  if (!usable || !status?.available) return null;

  async function start() {
    setError(null);
    try {
      await setUp(setStep);
      notify("Your Stellar address is ready for USDC");
    } catch (e) {
      const msg = (e as Error).message ?? "";
      setError(/reject|denied|cancel/i.test(msg) ? "Cancelled. Nothing was changed." : msg || "Something went wrong. Try again.");
    } finally {
      setStep(null);
    }
  }

  return (
    <section className="ap-card" aria-labelledby="stellar-title">
      <div className="ap-card-head">
        <h2 id="stellar-title">USDC on Stellar</h2>
        <span className="ap-chip">{STELLAR_NETWORK === "testnet" ? "Testnet" : "Live"}</span>
      </div>
      {account && ready ? (
        <>
          <p className="ap-muted">Send USDC on Stellar to this address. It stays yours; bills you turn this on for are paid from it, never above the limit you approve.</p>
          <div className="ap-address">
            {qr && <div className="ap-qr" aria-hidden="true" dangerouslySetInnerHTML={{ __html: qr }} />}
            <div className="ap-address-body">
              <code className="mono" aria-label="Your Stellar address">
                {account}
              </code>
              <button
                className="btn btn-primary btn-sm"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(account);
                    notify("Address copied");
                  } catch {
                    notify("Couldn't copy. Press and hold the address to copy it.");
                  }
                }}
              >
                Copy address
              </button>
            </div>
          </div>
          <div className="ap-warn" role="note">
            <b>Send only USDC on Stellar</b> (issued by Circle). You don&apos;t need XLM: ConstantUnits pays the network fees.
          </div>
          <ul className="ap-list ap-list-tight">
            <li className="ap-row">
              <span className="ap-token-logo">
                <img src="/tokens/usdc.png" alt="" width={40} height={40} />
              </span>
              <span className="ap-row-main">
                <b>USD Coin</b>
                <small>
                  USDC · Stellar ·{" "}
                  <a href={`${STELLAR_EXPLORER}/account/${account}`} target="_blank" rel="noreferrer">
                    Explorer
                  </a>
                </small>
              </span>
              <span className="ap-row-right mono">{status.usdc ?? "—"}</span>
            </li>
          </ul>
          <div className="ap-actions">
            <button className="btn btn-ghost btn-sm" onClick={() => load()}>
              Refresh
            </button>
            {STELLAR_NETWORK === "testnet" && (
              <a className="btn btn-ghost btn-sm" href="https://faucet.circle.com" target="_blank" rel="noreferrer">
                Get test USDC
              </a>
            )}
          </div>
        </>
      ) : (
        <>
          <p className="ap-muted">
            Hold USDC on Stellar and pay your TV bill from it. Your address comes with your ConstantUnits account: no app to install, no recovery words, no XLM.
          </p>
          <button className="btn btn-primary" onClick={start} disabled={step !== null}>
            {step ? STEP[step] : account ? "Finish setting up" : "Set up USDC on Stellar"}
          </button>
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
