"use client";

import { usePrivy, type User } from "@privy-io/react-auth";
import { SESSION_IDLE_DAYS } from "@constant/rules";
import { useCallback, useEffect, useId, useState } from "react";
import type { Session } from "@/lib/app/api";
import { formatDay, formatMoney, formatUnits6 } from "@/lib/app/format";
import { ApiError } from "@/lib/app/api";
import { STABLES, readStableBalances } from "@/lib/app/chains";
import { CONTACT_EMAIL } from "@/lib/site";
import type { Channel } from "@/lib/app/store";
import { displayName, type Store } from "./Shell";
import { useServer } from "./Server";
import { useNotify } from "./Toast";
import { billsDocument } from "@/lib/app/export";
import { SMS_LOGIN } from "./Providers";
import { useWalletAddress } from "./useWalletAddress";

const CHANNELS: { id: Channel; label: string }[] = [
  { id: "whatsapp", label: "WhatsApp" },
  { id: "telegram", label: "Telegram" },
  { id: "sms", label: "SMS" },
  { id: "email", label: "Email" },
];

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function Account({ user, store }: { user: User; store: Store }) {
  const { linkEmail, linkPhone, linkGoogle, linkPasskey, linkWallet, exportWallet } = usePrivy();
  const notify = useNotify();
  const server = useServer();
  const wallet = useWalletAddress(user);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmExport, setConfirmExport] = useState(false);
  const hasPasskey = user.linkedAccounts.some((a) => a.type === "passkey");
  const wallets = user.linkedAccounts.filter((a) => a.type === "wallet");

  const methods = [
    { label: "Google", value: user.google?.email, link: linkGoogle },
    { label: "Email", value: user.email?.address, link: linkEmail },
    // Phone only while Privy can text Nigerian numbers (SMS_LOGIN); a number already linked still shows.
    ...(SMS_LOGIN || user.phone?.number ? [{ label: "Phone", value: user.phone?.number, link: linkPhone }] : []),
    { label: "Passkey", value: hasPasskey ? "Added" : undefined, link: linkPasskey },
    { label: "Wallet", value: wallets.length ? `${wallets.length} linked` : undefined, link: linkWallet },
  ];

  const channels = store.plan.channels;
  const toggle = (c: Channel) => {
    const next = channels.includes(c) ? channels.filter((x) => x !== c) : [...channels, c];
    store.setChannels(next).catch((e: Error) => notify(e.message));
  };

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
        {server.me?.telegramBot && <TelegramConnect />}
      </section>

      <section className="ap-card" aria-labelledby="wallet-title">
        <h2 id="wallet-title">Your wallet</h2>
        {wallet.status === "ready" ? (
          <>
            <p className="ap-muted">
              {wallet.smart
                ? "Your ConstantUnits account on Base, created for you. It holds your stablecoins; only you can move them, and bills you approve can take only what you allowed."
                : wallet.embedded
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
                      <b>Your private key controls all the money in this wallet.</b> Anyone who sees it can take your funds. ConstantUnits will
                      never ask for it. Only export it to move this wallet into another app you trust.
                    </p>
                    <div className="ap-actions">
                      <button
                        className="btn btn-danger btn-sm"
                        onClick={async () => {
                          setConfirmExport(false);
                          try {
                            await exportWallet({ address: wallet.signer ?? wallet.address });
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
                <p className="ap-fine">The key is shown in a secure window from our wallet provider. ConstantUnits never sees it.</p>
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

      {server.enabled && <Security />}

      <section className="ap-card" aria-labelledby="data-title">
        <h2 id="data-title">Your data</h2>
        <p className="ap-muted">
          {store.onServer
            ? "Your bills are saved to your ConstantUnits account, so they're the same on every device. Phone, meter and smartcard numbers are stored encrypted."
            : "During the preview your bills are saved on this device only."}
        </p>
        <div className="ap-actions">
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => {
              // A readable page (opens on any phone, prints or saves as PDF), not a raw data file.
              const html = billsDocument(store.plan, (server.me?.lines ?? []).filter((l) => l.kind === "tv"), server.me?.user.displayName ?? store.plan.name ?? null);
              const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
              const a = document.createElement("a");
              a.href = url;
              a.download = `constantunits-bills-${new Date().toISOString().slice(0, 10)}.html`;
              a.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
              notify("Downloaded. Open it to view, print or save as PDF.");
            }}
          >
            Download my bills
          </button>
          {store.onServer ? null : confirmDelete ? (
            <>
              <button
                className="btn btn-danger btn-sm"
                onClick={() => {
                  store.dropFromDevice();
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

      <button className="btn btn-ghost" style={{ width: "100%" }} onClick={() => server.signOut("manual")}>
        Sign out
      </button>

      {server.enabled && <CloseAccount user={user} />}
    </div>
  );
}

function Profile({ user, store }: { user: User; store: Store }) {
  const notify = useNotify();
  const server = useServer();
  const id = useId();
  const saved = server.me?.user.displayName ?? store.plan.name ?? "";
  const [value, setValue] = useState(saved);
  // The account loads after first paint; show its saved name once it arrives, unless the person is typing.
  useEffect(() => setValue((v) => v || saved), [saved]);
  const [error, setError] = useState<string | null>(null);
  const trimmed = value.trim();

  return (
    <section className="ap-card" aria-labelledby="profile-title">
      <h2 id="profile-title">Your name</h2>
      <p className="ap-muted">What ConstantUnits calls you in the app and in messages.</p>
      <form
        className="ap-name-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (trimmed.length > 40) {
            setError("Keep it under 40 characters.");
            return;
          }
          setError(null);
          setValue(trimmed);
          store
            .setName(trimmed || null)
            .then(() => notify(trimmed ? `We'll call you ${trimmed}` : "Name cleared"))
            .catch((err: Error) => notify(err.message));
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

/** Where this account is signed in, and a way out everywhere (D-080). */
function Security() {
  const server = useServer();
  const notify = useNotify();
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [confirm, setConfirm] = useState(false);
  const { call } = server;
  const load = useCallback(() => {
    call<Session[]>("/v1/sessions")
      .then(setSessions)
      .catch(() => setSessions([]));
  }, [call]);
  useEffect(() => load(), [load]);

  return (
    <section className="ap-card" aria-labelledby="security-title">
      <h2 id="security-title">Signed in</h2>
      <p className="ap-muted">
        For your safety you&apos;re signed out after {SESSION_IDLE_DAYS} days without opening ConstantUnits, and every 30 days. Your bills keep
        running while you&apos;re signed out.
      </p>
      {sessions === null ? (
        <div className="ap-inline-state" role="status">
          <span className="ap-spinner" aria-hidden="true" />
        </div>
      ) : (
        sessions.length > 0 && (
          <ul className="ap-list ap-list-tight">
            {sessions.map((s, i) => (
              <li key={i} className="ap-row">
                <span className="ap-row-main">
                  <b>
                    {s.device}
                    {s.current && <span className="ap-chip">This device</span>}
                  </b>
                  <small>
                    Signed in {formatDay(new Date(s.signedInAt))} · last used {formatDay(new Date(s.lastSeenAt))}
                  </small>
                </span>
              </li>
            ))}
          </ul>
        )
      )}
      {confirm ? (
        <div className="ap-actions">
          <button
            className="btn btn-danger btn-sm"
            onClick={() => {
              notify("Signing out everywhere…");
              void server.signOut("everywhere", { everywhere: true });
            }}
          >
            Yes, sign out everywhere
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => setConfirm(false)}>
            Cancel
          </button>
        </div>
      ) : (
        <div className="ap-actions">
          <button className="btn btn-ghost btn-sm" onClick={() => setConfirm(true)}>
            Sign out of all devices
          </button>
        </div>
      )}
    </section>
  );
}

/**
 * Closing the account (D-081). Refused while naira is left or stablecoins sit in the ConstantUnits wallet, because
 * closing deletes the sign-in and the wallet created with it.
 */
function CloseAccount({ user }: { user: User }) {
  const server = useServer();
  const notify = useNotify();
  const wallet = useWalletAddress(user);
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [understood, setUnderstood] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stables, setStables] = useState<{ checked: boolean; held: { label: string; amount: bigint }[]; failed: boolean }>({ checked: false, held: [], failed: false });
  const id = useId();
  const naira = BigInt(server.me?.balance.ledgerMinor ?? "0");
  const addresses = wallet.status === "ready" ? [...new Set([wallet.address, wallet.signer].filter(Boolean) as `0x${string}`[])] : [];
  const key = addresses.join(",");

  // Look at the wallet only when the person opens this, and only the addresses ConstantUnits created.
  useEffect(() => {
    if (!open || !key) return;
    let live = true;
    (async () => {
      const held: { label: string; amount: bigint }[] = [];
      let failed = false;
      for (const a of key.split(",") as `0x${string}`[]) {
        const b = await readStableBalances(a);
        for (const t of STABLES) {
          const v = b[t.key];
          if (v === null || v === undefined) failed = true;
          else if (v > 0n) held.push({ label: `${t.symbol} on ${t.chain === "base" ? "Base" : "Arc"}`, amount: v });
        }
      }
      if (live) setStables({ checked: true, held, failed });
    })();
    return () => {
      live = false;
    };
  }, [open, key]);

  const blocked = naira !== 0n || stables.held.length > 0 || (open && !stables.checked && wallet.status === "ready");
  const ready = typed.trim() === "DELETE" && understood && !blocked && !busy;

  return (
    <section className="ap-card ap-danger-zone" aria-labelledby="close-title">
      <h2 id="close-title">Close account</h2>
      <p className="ap-muted">
        Closing stops every bill and erases your details, bill numbers, readings and sign-in. Payment records are kept without your details
        for five years, as the law requires. This can&apos;t be undone.
      </p>
      {!open ? (
        <div className="ap-actions">
          <button className="btn btn-ghost btn-sm" onClick={() => setOpen(true)}>
            Close my account…
          </button>
        </div>
      ) : (
        <form
          className="ap-form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!ready) return;
            setBusy(true);
            setError(null);
            try {
              await server.call("/v1/me", { method: "DELETE", body: { confirm: "DELETE" } });
              notify("Your account is closed");
              await server.signOut("manual");
            } catch (err) {
              setError(err instanceof ApiError ? err.message : "Something went wrong. Nothing was closed.");
              setBusy(false);
            }
          }}
        >
          {naira !== 0n && (
            <div className="ap-warn" role="alert">
              You have {formatMoney(naira, "NGN")} in ConstantUnits. Write to <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> to have it
              sent to a bank account in your name first.
            </div>
          )}
          {stables.held.length > 0 && (
            <div className="ap-warn" role="alert">
              Your ConstantUnits wallet holds {stables.held.map((h) => `${formatUnits6(h.amount)} ${h.label}`).join(" and ")}. Move it to
              another wallet first: closing deletes this wallet.
            </div>
          )}
          {open && wallet.status === "ready" && !stables.checked && (
            <div className="ap-inline-state" role="status">
              <span className="ap-spinner" aria-hidden="true" />
              <span className="ap-muted">Checking your wallet is empty…</span>
            </div>
          )}
          {stables.failed && stables.held.length === 0 && (
            <p className="ap-hint">We couldn&apos;t check every network. Make sure your wallet is empty before you continue.</p>
          )}
          <label className="ap-check-row">
            <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />
            <span>I understand my bills stop, and my ConstantUnits wallet and sign-in are deleted.</span>
          </label>
          <div className="ap-field">
            <label htmlFor={id}>Type DELETE to confirm</label>
            <input id={id} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" autoCapitalize="characters" spellCheck={false} />
          </div>
          {error && (
            <p className="ap-err" role="alert">
              {error}
            </p>
          )}
          <div className="ap-actions">
            <button className="btn btn-danger btn-sm" type="submit" disabled={!ready}>
              {busy ? "Closing…" : "Close my account"}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)} disabled={busy}>
              Keep my account
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

/** Connect a Telegram chat (D-082): a one-time link opens the bot, which confirms in the chat. */
function TelegramConnect() {
  const server = useServer();
  const notify = useNotify();
  const linked = Boolean(server.me?.user.telegram);
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (linked) {
    return (
      <div className="ap-row ap-row-flat">
        <span className="ap-row-main">
          <b>Telegram connected</b>
          <small>Send STOP in the chat to pause every bill, START to resume.</small>
        </span>
        <button
          className="btn btn-ghost btn-sm"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await server.call("/v1/telegram", { method: "DELETE" });
              await server.reload();
              notify("Telegram disconnected");
            } catch (e) {
              notify((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Disconnect
        </button>
      </div>
    );
  }
  return (
    <div className="ap-row ap-row-flat">
      <span className="ap-row-main">
        <b>Get tokens on Telegram</b>
        <small>{url ? "Tap Open, then Start in Telegram. The link works once, for 15 minutes." : "Receipts and tokens in a chat with the ConstantUnits bot."}</small>
      </span>
      {url ? (
        <a className="btn btn-primary btn-sm" href={url} target="_blank" rel="noopener noreferrer">
          Open Telegram
        </a>
      ) : (
        <button
          className="btn btn-ghost btn-sm"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              setUrl((await server.call<{ url: string }>("/v1/telegram/link", { method: "POST" })).url);
            } catch (e) {
              notify((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Connect
        </button>
      )}
    </div>
  );
}
