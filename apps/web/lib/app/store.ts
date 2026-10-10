"use client";

import { useCallback, useEffect, useState } from "react";
import type { Kind } from "./catalog";
import type { Currency } from "./format";

export type Reading = { at: string; value: number };

export type Line = {
  id: string;
  kind: Kind;
  provider: string;
  ref: string;
  nickname: string;
  currency: Currency;
  /** Minor units as a string (bigint). */
  amountMinor: string;
  /** Usage lines: buy when a reading is at or below this. */
  threshold?: number;
  /** Date lines: day of the month it renews (1–28). */
  renewDay?: number;
  /** Weekly spending cap, minor units. */
  weeklyCapMinor: string;
  status: "active" | "paused";
  readings: Reading[];
  createdAt: string;
};

export type Channel = "whatsapp" | "telegram" | "sms" | "email";

export type Plan = {
  version: 1;
  lines: Line[];
  channels: Channel[];
  /** What the app calls you. Falls back to your Google first name or email. */
  name?: string;
};

const EMPTY: Plan = { version: 1, lines: [], channels: ["whatsapp", "sms"] };
const key = (userId: string) => `constant.plan.v1.${userId}`;

function read(userId: string): Plan {
  try {
    const raw = window.localStorage.getItem(key(userId));
    if (!raw) return EMPTY;
    const p = JSON.parse(raw) as Plan;
    return p.version === 1 && Array.isArray(p.lines) ? p : EMPTY;
  } catch {
    return EMPTY;
  }
}

/**
 * The user's plan, kept on this device until the payments backend is live.
 * Scoped to the signed-in Privy user id, so two people on one phone don't mix.
 */
export function usePlan(userId: string) {
  const [plan, setPlan] = useState<Plan>(EMPTY);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setPlan(read(userId));
    setLoaded(true);
  }, [userId]);

  const save = useCallback(
    (next: Plan | ((p: Plan) => Plan)) => {
      setPlan((prev) => {
        const value = typeof next === "function" ? next(prev) : next;
        try {
          window.localStorage.setItem(key(userId), JSON.stringify(value));
        } catch {
          /* storage full or blocked: keep in memory */
        }
        return value;
      });
    },
    [userId],
  );

  const clear = useCallback(() => {
    try {
      window.localStorage.removeItem(key(userId));
    } catch {
      /* ignore */
    }
    setPlan(EMPTY);
  }, [userId]);

  return { plan, save, clear, loaded };
}

export const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
