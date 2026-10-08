"use client";

import { usePrivy, type User } from "@privy-io/react-auth";
import { useState } from "react";
import type { Channel } from "@/lib/app/store";
import type { Store } from "./Shell";

const CHANNELS: { id: Channel; label: string }[] = [
  { id: "whatsapp", label: "WhatsApp" },
  { id: "telegram", label: "Telegram" },
  { id: "sms", label: "SMS" },
  { id: "email", label: "Email" },
];

export function Account({ user, store }: { user: User; store: Store }) {
  const { logout, linkEmail, linkPhone, linkGoogle, linkPasskey, linkWallet } = usePrivy();
  const [confirm, setConfirm] = useState(false);
  const hasPasskey = user.linkedAccounts.some((a) => a.type === "passkey");
  const wallets = user.linkedAccounts.filter((a) => a.type === "wallet");

  const methods = [
    { label: "Google", value: user.google?.email, link: linkGoogle },
    { label: "Email", value: user.email?.address, link: linkEmail },
    { label: "Phone", value: user.phone?.number, link: linkPhone },
    { label: "Passkey", value: hasPasskey ? "Added" : undefined, link: linkPasskey },
    {
      label: "Wallet",
      value: wallets.length ? `${wallets.length} linked` : undefined,
      link: linkWallet,
    },
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

      <section className="ap-card" aria-labelledby="signin-methods">
        <h2 id="signin-methods">Ways to sign in</h2>
        <p className="ap-muted">Add more than one, so you never get locked out.</p>
        <ul className="ap-list ap-list-tight">
          {methods.map((m) => (
            <li key={m.label} className="ap-row">
              <span className="ap-row-main">
                <b>{m.label}</b>
                <small>{m.value ?? "Not added"}</small>
              </span>
              {!m.value || m.label === "Wallet" ? (
                <button className="btn btn-ghost btn-sm" onClick={() => m.link()}>
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
        <p className="ap-muted">In this order. SMS is always the backup for electricity tokens.</p>
        <div className="ap-chips">
          {CHANNELS.map((c) => {
            const i = channels.indexOf(c.id);
            return (
              <button key={c.id} className="ap-chip-btn" data-on={i >= 0} onClick={() => toggle(c.id)} aria-pressed={i >= 0}>
                {i >= 0 && <span className="ap-order">{i + 1}</span>}
                {c.label}
              </button>
            );
          })}
        </div>
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
              a.download = "constant-plan.json";
              a.click();
              URL.revokeObjectURL(url);
            }}
          >
            Download
          </button>
          {confirm ? (
            <button
              className="btn btn-danger btn-sm"
              onClick={() => {
                store.clear();
                setConfirm(false);
              }}
            >
              Confirm delete
            </button>
          ) : (
            <button className="btn btn-ghost btn-sm" onClick={() => setConfirm(true)}>
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
