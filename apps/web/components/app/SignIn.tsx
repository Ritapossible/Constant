"use client";

import { useLogin } from "@privy-io/react-auth";
import { motion } from "motion/react";
import { useState } from "react";
import { Logo } from "@/components/Logo";

type Method = "google" | "email" | "sms" | "passkey" | "wallet";

const BUTTONS: { m: Method; label: string; icon: React.ReactNode }[] = [
  { m: "google", label: "Continue with Google", icon: <GoogleMark /> },
  { m: "email", label: "Continue with email", icon: <Glyph d="M3 6.5A1.5 1.5 0 0 1 4.5 5h15A1.5 1.5 0 0 1 21 6.5v11a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5v-11Zm1 .5 8 6 8-6" /> },
  { m: "sms", label: "Continue with phone number", icon: <Glyph d="M8 2.5h8A1.5 1.5 0 0 1 17.5 4v16a1.5 1.5 0 0 1-1.5 1.5H8A1.5 1.5 0 0 1 6.5 20V4A1.5 1.5 0 0 1 8 2.5ZM11 18.5h2" /> },
  { m: "passkey", label: "Use a passkey", icon: <Glyph d="M9 12.5a4 4 0 1 1 3.5-6l8 .01v3h-2v2h-2v-2h-2.6A4 4 0 0 1 9 12.5Zm-1.5-4h.01" /> },
  { m: "wallet", label: "Continue with a wallet", icon: <Glyph d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18v4M4 7.5V17a2.5 2.5 0 0 0 2.5 2.5h14V9.5h-14A2.5 2.5 0 0 1 4 7.5Zm12 6.5h1.5" /> },
];

export function SignIn() {
  const [busy, setBusy] = useState<Method | null>(null);
  const { login } = useLogin({ onComplete: () => setBusy(null), onError: () => setBusy(null) });

  return (
    <div className="ap-signin">
      <div className="ap-signin-bg" aria-hidden="true" />
      <header className="ap-signin-top">
        <a href="/" aria-label="Constant home">
          <Logo />
        </a>
      </header>
      <motion.section
        className="ap-signin-card"
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        aria-labelledby="signin-title"
      >
        <p className="ap-kicker">Your Constant account</p>
        <h1 id="signin-title">
          Set it once. <span className="serif">Never run out.</span>
        </h1>
        <p className="ap-muted">Keep data, light, cable and subscriptions paid, and get warned before anything runs low.</p>
        <div className="ap-signin-buttons">
          {BUTTONS.map((b, i) => (
            <motion.button
              key={b.m}
              className="ap-auth-btn"
              onClick={() => {
                setBusy(b.m);
                login({ loginMethods: [b.m] });
              }}
              disabled={busy !== null && busy !== b.m}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 + i * 0.05, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
            >
              <span className="ap-auth-icon">{b.icon}</span>
              {b.label}
            </motion.button>
          ))}
        </div>
        <p className="ap-fine">
          No seed phrase. A wallet sign-in proves ownership with a signature; it never moves funds. By continuing you agree to
          our <a href="/privacy">privacy notice</a>.
        </p>
      </motion.section>
    </div>
  );
}

function Glyph({ d }: { d: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

function GoogleMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.6-.4-3.5Z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7Z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44Z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.5Z" />
    </svg>
  );
}
