"use client";

import type { User } from "@privy-io/react-auth";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { LogoMark } from "@/components/Logo";
import { usePlan } from "@/lib/app/store";
import { Account } from "./Account";
import { Bills } from "./Bills";
import { Home } from "./Home";
import { Money } from "./Money";
import { ServerProvider, useServer } from "./Server";
import { ToastProvider } from "./Toast";

type Tab = "home" | "bills" | "money" | "account";

const TABS: { id: Tab; label: string; d: string }[] = [
  { id: "home", label: "Home", d: "M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1v-9.5Z" },
  { id: "bills", label: "Bills", d: "M6 3h12v18l-3-2-3 2-3-2-3 2V3Zm3 5h6M9 12h6" },
  { id: "money", label: "Money", d: "M4 7.5A2.5 2.5 0 0 1 6.5 5H18v4M4 7.5V17a2.5 2.5 0 0 0 2.5 2.5h14V9.5h-14A2.5 2.5 0 0 1 4 7.5Zm12 6.5h1.5" },
  { id: "account", label: "Account", d: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 9a7 7 0 0 1 14 0" },
];

const isTab = (v: string): v is Tab => TABS.some((t) => t.id === v);

export function displayName(user: User, name?: string): string {
  return name?.trim() || user.google?.name?.split(" ")[0] || user.email?.address?.split("@")[0] || "there";
}

/** Ways to sign in, not counting the wallet Constant created for the user. */
export function signInMethods(user: User): number {
  return user.linkedAccounts.filter((a) => !(a.type === "wallet" && a.walletClientType === "privy") && a.type !== "smart_wallet").length;
}

/** The open tab lives in the URL (#bills), so refresh, back and shared links work. */
function useTab(): [Tab, (t: Tab) => void] {
  const [tab, setTabState] = useState<Tab>("home");
  useEffect(() => {
    const read = () => {
      const h = window.location.hash.slice(1);
      setTabState(isTab(h) ? h : "home");
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);
  const setTab = useCallback((t: Tab) => {
    if (window.location.hash.slice(1) !== t) window.history.pushState(null, "", `#${t}`);
    setTabState(t);
  }, []);
  return [tab, setTab];
}

export function Shell({ user }: { user: User }) {
  const [tab, setTab] = useTab();
  const store = usePlan(user.id);
  const main = useRef<HTMLElement>(null);
  const first = useRef(true);

  // On tab change: back to the top, and focus the new page so screen readers announce it.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    window.scrollTo({ top: 0 });
    main.current?.focus({ preventScroll: true });
  }, [tab]);

  return (
    <MotionConfig reducedMotion="user">
    <ToastProvider>
    <ServerProvider>
    <div className="ap">
      <aside className="ap-side" aria-label="App navigation">
        <a href="/" className="ap-brand" aria-label="Constant home">
          <LogoMark />
          <span>Constant</span>
        </a>
        <nav className="ap-nav">
          {TABS.map((t) => (
            <button key={t.id} className="ap-nav-item" data-on={tab === t.id} onClick={() => setTab(t.id)} aria-current={tab === t.id ? "page" : undefined}>
              <Icon d={t.d} />
              {t.label}
            </button>
          ))}
        </nav>
        <PreviewNote />
      </aside>

      <main className="ap-main" id="main" ref={main} tabIndex={-1} aria-label={TABS.find((t) => t.id === tab)?.label}>
        <div className="ap-mobile-top">
          <a href="/" className="ap-brand" aria-label="Constant home">
            <LogoMark />
            <span>Constant</span>
          </a>
          <PreviewBadge />
        </div>
        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 10, filter: "blur(4px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: -6, filter: "blur(4px)" }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
          >
            {!store.loaded ? null : tab === "home" ? (
              <Home user={user} store={store} goTo={setTab} />
            ) : tab === "bills" ? (
              <Bills store={store} />
            ) : tab === "money" ? (
              <Money user={user} plan={store.plan} />
            ) : (
              <Account user={user} store={store} />
            )}
          </motion.div>
        </AnimatePresence>
      </main>

      <nav className="ap-tabbar" aria-label="App navigation">
        {TABS.map((t) => (
          <button key={t.id} className="ap-tab" data-on={tab === t.id} onClick={() => setTab(t.id)} aria-current={tab === t.id ? "page" : undefined}>
            <Icon d={t.d} />
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
    </ServerProvider>
    </ToastProvider>
    </MotionConfig>
  );
}

/** "Preview" stays until the server says payments are on (Grok review, 2026-10-10). */
function usePreview() {
  const server = useServer();
  return !(server.enabled && server.me?.payments === "on");
}

function PreviewBadge() {
  return usePreview() ? <span className="ap-badge">Preview</span> : null;
}

function PreviewNote() {
  const server = useServer();
  if (!usePreview()) return null;
  return (
    <div className="ap-preview-note">
      <b>Preview</b>
      <span>
        {server.enabled
          ? "Cable TV bills are saved to your account. Payments switch on with our licensed partner."
          : "Payments switch on with our licensed partner. Your plan is saved on this device."}
      </span>
    </div>
  );
}

export function Icon({ d, size = 20 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

export type Store = ReturnType<typeof usePlan>;
export type GoTo = (t: Tab) => void;
