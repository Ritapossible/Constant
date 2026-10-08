"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useEffect, useState } from "react";
import { Logo } from "@/components/Logo";
import { PRIVY_APP_ID, Providers } from "./Providers";
import { Shell } from "./Shell";
import { SignIn } from "./SignIn";

export function AppRoot() {
  if (!PRIVY_APP_ID) return <NotConfigured />;
  return (
    <Providers>
      <Gate />
    </Providers>
  );
}

function Gate() {
  const { ready, authenticated, user } = usePrivy();
  if (!ready) return <Splash />;
  if (!authenticated || !user) return <SignIn />;
  return <Shell user={user} />;
}

function Splash() {
  // If sign-in can't load (offline, blocked, or a misconfigured app), say so instead of spinning forever.
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 15000);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="ap-splash" role="status" aria-live="polite">
      <Logo />
      {slow ? (
        <>
          <p className="ap-muted" style={{ maxWidth: 320, textAlign: "center" }}>
            Sign-in is taking longer than usual. Check your connection and try again.
          </p>
          <button className="btn btn-primary btn-sm" onClick={() => window.location.reload()}>
            Try again
          </button>
        </>
      ) : (
        <div className="ap-spinner" aria-label="Loading" />
      )}
    </div>
  );
}

function NotConfigured() {
  return (
    <div className="ap-splash">
      <Logo />
      <p className="ap-muted" style={{ maxWidth: 360, textAlign: "center" }}>
        Sign-in is not configured yet. Set <code>NEXT_PUBLIC_PRIVY_APP_ID</code> in the deployment settings.
      </p>
      <a className="btn btn-ghost btn-sm" href="/">
        Back to home
      </a>
    </div>
  );
}
