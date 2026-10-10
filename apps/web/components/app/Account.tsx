"use client";

import { usePrivy, type User } from "@privy-io/react-auth";
import { useId, useState } from "react";
import type { Channel } from "@/lib/app/store";
import { displayName, type Store } from "./Shell";
import { useNotify } from "./Toast";
import { useWalletAddress } from "./useWalletAddress";

const CHANNELS: { id: Channel; label: string }[] = [
  { id: "whatsapp", label: "WhatsApp" },
  { id: "telegram", label: "Telegram" },
  { id: "sms", label: "SMS" },
  { id: "email", label: "Email" },
];

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function Account({ user, store }: { user: User; store: Store }) {
  const { logout, linkEmail, linkPhone, linkGoogle, linkPasskey, linkWallet, exportWallet } = usePrivy();
  const notify = useNotify();
  const wallet = useWalletAddress(user);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmExport, setConfirmExport] = useState(false);
  const hasPasskey = user.linkedAccounts.some((a) => a.type === "passkey");
  const wallets = user.linkedAccounts.filter((a) => a.type === "wallet");

  const methods = [
    { label: "Google", value: user.google?.email, link: linkGoogle },
    { label: "Email", value: user.email?.address, link: linkEmail },
    { label: "Phone", value: user.phone?.number, link: linkPhone },
    { label: "Passkey", value: hasPasskey ? "Added" : undefined, link: linkPasskey },
    { label: "Wallet", value: wallets.length ? `${wallets.length} linked` : undefined, link: linkWallet },
  ];

  const channels = store.plan.channels;
  const toggle = (c: Channel) =>
    store.save((p) => ({ ...p, channels: p.channels.includes(c) ? p.channels.filter((x) => x !== c) : [...p.channels, c] }));

  return (
    <div className="ap-page">
      <header className="ap-page-head">
        <p className="ap-kicker">Account</p>
        <h1>You</h1>
      </header>

      <Profile user={user} store={store} />

      <section className="ap-card" aria-labelledby="signin-methods">
        <h2 id="signin-methods">Ways to sign in</h2>
        <p className="ap-muted">Add more than one so you never get locked out.</p>
        <ul className="ap-list ap-list-tight">
          {methods.map((m) => (
            <li key={m.label} className="ap-row">
              <span className="ap-row-main">
                <b>{m.label}</b>
                <small>{m.value ?? "Not added"}</small>
              </span>
              {!m.value || m.label === "Wallet" ? (
                <button className="btn btn-ghost btn-sm" onClick={() => m.link()} aria-label={`${m.value ? "Add another" : "Add"} ${m.label.toLowerCase()}`}>
                  {m.value ? "Add another" : "Add"}
                </button>
              ) : (
                <span className="ap-chip">Added</span>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="ap-card" aria-labelledby="delivery">
        <h2 id="delivery">Where tokens and receipts go</h2>
        <p className="ap-muted">Tap to choose, in order. SMS is always the backup for electricity tokens.</p>
        <div className="ap-chips" role="group" aria-labelledby="delivery">
          {CHANNELS.map((c) => {
            const i = channels.indexOf(c.id);
            return (
              <button
                key={c.id}
                className="ap-chip-btn"
                data-on={i >= 0}
                onClick={() => toggle(c.id)}
                aria-pressed={i >= 0}
                aria-label={i >= 0 ? `${c.label}, choice ${i + 1}` : c.label}
              >
                {i >= 0 && (
                  <span className="ap-order" aria-hidden="true">
                    {i + 1}
                  </span>
                )}
                {c.label}
              </button>
            );
          })}
        </div>
        {channels.length === 0 && <p className="ap-hint">Nothing selected: tokens will come by SMS.</p>}
      </section>

      <section className="ap-card" aria-labelledby="wallet-title">
        <h2 id="wallet-title">Your wallet</h2>
        {wallet.status === "ready" ? (
          <>
            <p className="ap-muted">
              {wallet.embedded
                ? "Created for you when you signed in. It holds your stablecoins, and only you can move them."
                : "The wallet you signed in with. Stablecoins you send to it stay in your control."}
            </p>
            <div className="ap-row ap-row-flat">
              <span className="ap-row-main">
                <b className="mono">{short(wallet.address)}</b>
                <small>Base and Arc</small>
              </span>
              <button
                className="btn btn-ghost btn-sm"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(wallet.address);
                    notify("Address copied");
                  } catch {
                    notify("Couldn't copy the address");
                  }
                }}
              >
                Copy
              </button>
            </div>
            {wallet.embedded && (
              <details className="ap-details ap-export">
                <summary>Advanced: move this wallet to another app</summary>
                {confirmExport ? (
                  <div className="ap-warn" role="alert">
                    <p style={{ margin: "0 0 10px" }}>
                      <b>Your private key controls all the money in this wallet.</b> Anyone who sees it can take your funds. Constant will
                      never ask for it. Only export it to move this wallet into another app you trust.
                    </p>
                    <div className="ap-actions">
                      <button
                        className="btn btn-danger btn-sm"
                        onClick={async () => {
                          setConfirmExport(false);
                          try {
                            await exportWallet({ address: wallet.address });
                          } catch {
                            notify("Export was cancelled");
                          }
                        }}
                      >
                        I understand, show my key
                      </button>
                      <button className="btn btn-ghost btn-sm" onClick={() => setConfirmExport(false)}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button className="btn btn-ghost btn-sm" onClick={() => setConfirmExport(true)}>
                    Export private key
                  </button>
                )}
                <p className="ap-fine">The key is shown in a secure window from our wallet provider. Constant never sees it.</p>
              </details>
            )}
          </>
        ) : wallet.status === "error" ? (
          <div className="ap-inline-state" role="alert">
            <p className="ap-muted">We couldn&apos;t set up your wallet.</p>
            <button className="btn btn-primary btn-sm" onClick={wallet.retry}>
              Try again
            </button>
          </div>
        ) : (
          <div className="ap-inline-state" role="status">
            <span className="ap-spinner" aria-hidden="true" />
            <p className="ap-muted">Setting up your wallet…</p>
          </div>
        )}
      </section>

      <section className="ap-card" aria-labelledby="data-title">
        <h2 id="data-title">Your data</h2>
        <p className="ap-muted">During the preview your bills are saved on this device only.</p>
        <div className="ap-actions">
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => {
              const blob = new Blob([JSON.stringify(store.plan, null, 2)], { type: "application/json" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = "constant-bills.json";
              a.click();
              URL.revokeObjectURL(url);
              notify("Downloaded");
            }}
          >
            Download my bills
          </button>
          {confirmDelete ? (
            <>
              <button
                className="btn btn-danger btn-sm"
                onClick={() => {
                  store.clear();
                  setConfirmDelete(false);
                  notify("Your data was deleted from this device");
                }}
              >
                Yes, delete
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setConfirmDelete(false)}>
                Keep them
              </button>
            </>
          ) : (
            <button className="btn btn-ghost btn-sm" onClick={() => setConfirmDelete(true)}>
              Delete from this device
            </button>
          )}
        </div>
      </section>

      <button className="btn btn-ghost" style={{ width: "100%" }} onClick={() => logout()}>
        Sign out
      </button>
    </div>
  );
}

function Profile({ user, store }: { user: User; store: Store }) {
  const notify = useNotify();
  const id = useId();
  const saved = store.plan.name ?? "";
  const [value, setValue] = useState(saved);
  const [error, setError] = useState<string | null>(null);
  const trimmed = value.trim();

  return (
    <section className="ap-card" aria-labelledby="profile-title">
      <h2 id="profile-title">Your name</h2>
      <p className="ap-muted">What Constant calls you in the app and in messages.</p>
      <form
        className="ap-name-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (trimmed.length > 40) {
            setError("Keep it under 40 characters.");
            return;
          }
          setError(null);
          store.save((p) => ({ ...p, name: trimmed || undefined }));
          setValue(trimmed);
          notify(trimmed ? `We'll call you ${trimmed}` : "Name cleared");
        }}
      >
        <div className="ap-field">
          <label htmlFor={id} className="sr-only">
            Display name
          </label>
          <input
            id={id}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={displayName(user)}
            autoComplete="nickname"
            maxLength={60}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? `${id}-err` : undefined}
          />
        </div>
        <button className="btn btn-primary" type="submit" disabled={trimmed === saved}>
          Save
        </button>
      </form>
      {error && (
        <span id={`${id}-err`} className="ap-err" role="alert">
          {error}
        </span>
      )}
    </section>
  );
}
