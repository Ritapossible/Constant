"use client";

import { usePrivy } from "@privy-io/react-auth";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { API_URL, ApiError, type Me } from "@/lib/app/api";

/** Why the person was signed out, shown once on the sign-in screen (D-080). */
export type SignOutReason = "expired" | "idle" | "everywhere" | "manual";
export const SIGN_OUT_KEY = "cu.signout";

function remember(reason: SignOutReason) {
  try {
    if (reason !== "manual") window.sessionStorage.setItem(SIGN_OUT_KEY, reason);
  } catch {
    /* storage blocked: the sign-in screen just won't say why */
  }
}

type Call = <T>(path: string, init?: { method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; body?: unknown }) => Promise<T>;
type SignOut = (reason: SignOutReason, opts?: { everywhere?: boolean }) => Promise<void>;

type Server = {
  /** False when no API is configured: the app runs as the on-device preview. */
  enabled: boolean;
  me: Me | null;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  call: Call;
  /** Ends this session on the server too, so its token is refused from now on, then signs out here. */
  signOut: SignOut;
};

/** Exported for tests and previews that provide their own server. */
export const ServerContext = createContext<Server>({
  enabled: false,
  me: null,
  loading: false,
  error: null,
  reload: async () => undefined,
  call: async () => Promise.reject(new Error("no api")),
  signOut: async () => undefined,
});

export const useServer = () => useContext(ServerContext);

/** Loads the signed-in user's account from the API and keeps it fresh while the app is open. */
export function ServerProvider({ children }: { children: ReactNode }) {
  const { getAccessToken, logout } = usePrivy();
  const leaving = useRef(false);
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(Boolean(API_URL));
  const [error, setError] = useState<string | null>(null);

  const call: Call = useCallback(
    async <T,>(path: string, init?: { method?: string; body?: unknown }) => {
      const token = await getAccessToken();
      if (!token) throw new ApiError(401, "unauthenticated", "Sign in again");
      let res: Response;
      try {
        res = await fetch(`${API_URL}${path}`, {
          method: init?.method ?? "GET",
          headers: {
            authorization: `Bearer ${token}`,
            ...(init?.body !== undefined ? { "content-type": "application/json" } : {}),
            // Every change carries its own key, so a request the network retried is applied once (D-087).
            ...(init?.method && init.method !== "GET" ? { "idempotency-key": crypto.randomUUID() } : {}),
          },
          ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
        });
      } catch {
        throw new ApiError(0, "offline", "Can't reach ConstantUnits. Check your connection.");
      }
      if (res.status === 204) return undefined as T;
      const body = await res.json().catch(() => ({}));
      if (res.status === 401 && body.error === "session_expired" && !leaving.current) {
        // The server ended this session (unused for a week, a month old, or signed out elsewhere): sign out here too.
        leaving.current = true;
        remember("expired");
        void logout();
      }
      if (!res.ok) throw new ApiError(res.status, body.error ?? "error", body.message ?? "Something went wrong. Try again.");
      return body as T;
    },
    [getAccessToken, logout],
  );

  const signOut: SignOut = useCallback(
    async (reason, opts) => {
      if (leaving.current) return;
      leaving.current = true;
      remember(reason);
      if (API_URL) {
        // Best effort: if the network is down, the server still ends the session after a week unused.
        await call(opts?.everywhere ? "/v1/sessions/end-all" : "/v1/session/end", { method: "POST" }).catch(() => undefined);
      }
      await logout();
    },
    [call, logout],
  );

  const reload = useCallback(async () => {
    if (!API_URL) return;
    try {
      setMe(await call<Me>("/v1/me"));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [call]);

  useEffect(() => {
    if (!API_URL) return;
    reload();
    // Refresh when the person comes back to the tab, and every minute while they're looking at it. A hidden tab
    // doesn't poll, so a tab left open doesn't keep the session alive on its own.
    const onFocus = () => document.visibilityState === "visible" && reload();
    document.addEventListener("visibilitychange", onFocus);
    const t = setInterval(() => document.visibilityState === "visible" && reload(), 60_000);
    return () => {
      document.removeEventListener("visibilitychange", onFocus);
      clearInterval(t);
    };
  }, [reload]);

  const value = useMemo(() => ({ enabled: Boolean(API_URL), me, loading, error, reload, call, signOut }), [me, loading, error, reload, call, signOut]);
  return <ServerContext.Provider value={value}>{children}</ServerContext.Provider>;
}
