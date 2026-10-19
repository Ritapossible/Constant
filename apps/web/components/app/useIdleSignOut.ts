"use client";

import { SESSION_IDLE_DAYS } from "@constant/rules";
import { useEffect } from "react";
import { useServer } from "./Server";

const IDLE_MS = SESSION_IDLE_DAYS * 86_400_000;
const WRITE_EVERY_MS = 60_000;
const key = (userId: string) => `cu.active.${userId}`;

function read(userId: string): number | null {
  try {
    const v = Number(window.localStorage.getItem(key(userId)));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

function write(userId: string, t: number) {
  try {
    window.localStorage.setItem(key(userId), String(t));
  } catch {
    /* storage blocked: the server still ends the session after a week unused */
  }
}

/**
 * Signs the person out on this device after a week without using the app (D-080), matching the server. Only a
 * real tap, key or return to the tab counts as use; the app refreshing itself in the background doesn't.
 */
export function useIdleSignOut(userId: string) {
  const { signOut } = useServer();
  useEffect(() => {
    const now = Date.now();
    const last = read(userId);
    if (last !== null && now - last > IDLE_MS) {
      void signOut("idle");
      return;
    }
    write(userId, now);
    let lastWrite = now;
    const touch = () => {
      const t = Date.now();
      if (t - lastWrite >= WRITE_EVERY_MS) {
        write(userId, t);
        lastWrite = t;
      }
    };
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      const seen = read(userId);
      if (seen !== null && Date.now() - seen > IDLE_MS) void signOut("idle");
      else touch();
    };
    window.addEventListener("pointerdown", touch, { passive: true });
    window.addEventListener("keydown", touch);
    document.addEventListener("visibilitychange", onVisible);
    // A tab left open for days: check now and then, without counting the check as use.
    const t = setInterval(() => {
      const seen = read(userId);
      if (seen !== null && Date.now() - seen > IDLE_MS) void signOut("idle");
    }, 10 * 60_000);
    return () => {
      window.removeEventListener("pointerdown", touch);
      window.removeEventListener("keydown", touch);
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(t);
    };
  }, [userId, signOut]);
}
