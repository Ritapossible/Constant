"use client";

import { usePrivy } from "@privy-io/react-auth";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { API_URL, ApiError, type Me } from "@/lib/app/api";

type Call = <T>(path: string, init?: { method?: "GET" | "POST" | "PATCH" | "DELETE"; body?: unknown }) => Promise<T>;

type Server = {
  /** False when no API is configured: the app runs as the on-device preview. */
  enabled: boolean;
  me: Me | null;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  call: Call;
};

/** Exported for tests and previews that provide their own server. */
export const ServerContext = createContext<Server>({ enabled: false, me: null, loading: false, error: null, reload: async () => undefined, call: async () => Promise.reject(new Error("no api")) });

export const useServer = () => useContext(ServerContext);

/** Loads the signed-in user's account from the API and keeps it fresh while the app is open. */
export function ServerProvider({ children }: { children: ReactNode }) {
  const { getAccessToken } = usePrivy();
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
          headers: { authorization: `Bearer ${token}`, ...(init?.body !== undefined ? { "content-type": "application/json" } : {}) },
          ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
        });
      } catch {
        throw new ApiError(0, "offline", "Can't reach Constant. Check your connection.");
      }
      if (res.status === 204) return undefined as T;
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new ApiError(res.status, body.error ?? "error", body.message ?? "Something went wrong. Try again.");
      return body as T;
    },
    [getAccessToken],
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
    // Refresh when the person comes back to the tab, and every minute while it's open.
    const onFocus = () => document.visibilityState === "visible" && reload();
    document.addEventListener("visibilitychange", onFocus);
    const t = setInterval(reload, 60_000);
    return () => {
      document.removeEventListener("visibilitychange", onFocus);
      clearInterval(t);
    };
  }, [reload]);

  const value = useMemo(() => ({ enabled: Boolean(API_URL), me, loading, error, reload, call }), [me, loading, error, reload, call]);
  return <ServerContext.Provider value={value}>{children}</ServerContext.Provider>;
}
