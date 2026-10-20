"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, type ServerLine } from "@/lib/app/api";
import { usePlan, type Channel, type Line, type Plan } from "@/lib/app/store";
import { useServer } from "./Server";

/** A bill that couldn't be moved from this phone to the account, and why. */
export type Unmoved = { line: Line; reason: string };

export type Store = {
  /** Bills other than cable, the message channels and the name. From the account when the API is on. */
  plan: Plan;
  loaded: boolean;
  /** True when bills are saved on the ConstantUnits account; false only in the on-device preview (no API). */
  onServer: boolean;
  add: (line: Line, extra?: { variationCode?: string | null }) => Promise<void>;
  update: (next: Line, extra?: { variationCode?: string | null }) => Promise<void>;
  remove: (line: Line) => Promise<void>;
  addReading: (line: Line, value: number) => Promise<void>;
  topUpNow: (line: Line) => Promise<void>;
  setChannels: (channels: Channel[]) => Promise<void>;
  setName: (name: string | null) => Promise<void>;
  /** Bills still on this phone that the account refused, with the reason. Empty once all have moved. */
  unmoved: Unmoved[];
  /** Forget bills still on this phone (they couldn't move, or the person doesn't want them). */
  dropFromDevice: (ids?: string[]) => void;
};

/** A bill from the account, in the shape the screens use. */
export function fromServer(l: ServerLine): Line {
  const amount = l.amountMinor ?? l.capMinor;
  return {
    id: l.id,
    kind: l.kind === "tv" ? "tv" : l.kind,
    provider: l.provider,
    ref: l.last4,
    nickname: l.nickname,
    currency: l.currency,
    amountMinor: amount,
    threshold: l.threshold ?? undefined,
    renewDay: l.renewDay ?? undefined,
    ...(l.meterType ? { meterType: l.meterType } : {}),
    weeklyCapMinor: l.schedule === "usage" ? (l.weeklyCapMinor ?? amount) : l.capMinor,
    status: l.status === "paused" ? "paused" : "active",
    readings: l.readings,
    createdAt: l.createdAt,
    schedule: l.schedule === "usage" ? "usage" : l.schedule === "none" ? "none" : "monthly",
    onServer: true,
    held: l.status === "frozen",
    customerName: l.customerName,
    planName: l.planName,
    variationCode: l.variationCode,
    setupNeeded: l.setupNeeded,
    nextRunAt: l.nextRunAt,
    potMinor: l.potMinor,
  };
}

const usage = (l: Line) => l.schedule === "usage" || (!l.schedule && l.kind !== "subscription" && l.kind !== "tv" && !(l.kind === "electricity" && l.meterType === "postpaid"));

/** What the API needs to create this bill. `imported`: it is moving from this phone. */
export function toServerBody(l: Line, opts: { imported?: boolean; variationCode?: string | null } = {}) {
  const isUsage = usage(l);
  return {
    kind: l.kind,
    provider: l.provider,
    ref: l.ref,
    nickname: l.nickname,
    amountMinor: l.amountMinor,
    status: l.status,
    ...(l.kind === "subscription" ? { renewDay: l.renewDay ?? 1 } : isUsage ? { schedule: "usage", threshold: l.threshold ?? 0, weeklyCapMinor: l.weeklyCapMinor } : { schedule: "monthly", renewDay: l.renewDay ?? 1, capMinor: l.weeklyCapMinor }),
    ...(l.kind === "electricity" ? { meterType: l.meterType ?? "prepaid" } : {}),
    ...(opts.variationCode ? { variationCode: opts.variationCode } : {}),
    ...(opts.imported ? { import: true, readings: l.readings } : {}),
  };
}

/** The changes the API accepts for a bill already on the account. The payee and provider never change. */
function toServerPatch(next: Line, prev: Line, variationCode?: string | null) {
  const out: Record<string, unknown> = {};
  if (next.nickname !== prev.nickname) out.nickname = next.nickname;
  if (next.status !== prev.status) out.status = next.status;
  if (variationCode && variationCode !== prev.variationCode) out.variationCode = variationCode;
  else if (next.kind !== "data" && next.amountMinor !== prev.amountMinor) out.amountMinor = next.amountMinor;
  if (usage(prev)) {
    if (next.threshold !== prev.threshold) out.threshold = next.threshold;
    if (next.weeklyCapMinor !== prev.weeklyCapMinor) out.weeklyCapMinor = next.weeklyCapMinor;
  } else {
    if (next.renewDay !== prev.renewDay) out.renewDay = next.renewDay;
    if (next.weeklyCapMinor !== prev.weeklyCapMinor && next.kind !== "subscription") out.capMinor = next.weeklyCapMinor;
  }
  return out;
}

const DEFAULT_CHANNELS: Channel[] = ["whatsapp", "sms"];

/**
 * The person's bills, name and message channels. With the API on, everything is read from and written to their
 * account, and anything still saved on this phone from the preview is moved there once, then removed from the
 * phone. Without an API (local development), it falls back to this device.
 */
export function useAccountStore(userId: string): Store {
  const server = useServer();
  const device = usePlan(userId);
  const onServer = server.enabled;
  const [unmoved, setUnmoved] = useState<Unmoved[]>([]);
  // Once per app load: a bill the account refused is tried again next time the app opens, not in a loop.
  const moved = useRef(false);

  const call = server.call;
  const reload = server.reload;

  // Move bills saved on this phone to the account, once the account has loaded. Each one that moves is removed from
  // the phone; one the account refuses stays, with the reason, until the person fixes or drops it.
  useEffect(() => {
    if (!onServer || !server.me || !device.loaded || moved.current) return;
    const local = device.plan;
    const pendingName = local.name && !server.me.user.displayName ? local.name : null;
    const sameChannels = local.channels.length === DEFAULT_CHANNELS.length && local.channels.every((c, i) => c === DEFAULT_CHANNELS[i]);
    const pendingChannels = !sameChannels && server.me.user.channels.join() === DEFAULT_CHANNELS.join() ? local.channels : null;
    if (local.lines.length === 0 && !pendingName && !pendingChannels) return;
    moved.current = true;
    (async () => {
      const failed: Unmoved[] = [];
      const done = new Set<string>();
      for (const line of local.lines) {
        try {
          await call("/v1/lines", { method: "POST", body: toServerBody(line, { imported: true }) });
          done.add(line.id);
        } catch (e) {
          // Already on the account (moved from another tab or device): nothing to keep here.
          if (e instanceof ApiError && e.code === "duplicate") done.add(line.id);
          else failed.push({ line, reason: (e as Error).message });
        }
      }
      try {
        if (pendingName || pendingChannels) {
          await call("/v1/me", { method: "PATCH", body: { ...(pendingName ? { displayName: pendingName } : {}), ...(pendingChannels ? { channels: pendingChannels } : {}) } });
        }
      } catch {
        // The name and channels can be set again in Account.
      }
      device.save((p) => ({ version: 1, lines: p.lines.filter((l) => !done.has(l.id)), channels: DEFAULT_CHANNELS }));
      setUnmoved(failed);
      await reload();
    })();
  }, [onServer, server.me, device, call, reload]);

  const plan: Plan = useMemo(() => {
    if (!onServer) return device.plan;
    const me = server.me;
    return {
      version: 1,
      lines: (me?.lines ?? []).filter((l) => l.kind !== "tv" && l.status !== "cancelled").map(fromServer),
      channels: me?.user.channels ?? DEFAULT_CHANNELS,
      ...(me?.user.displayName ? { name: me.user.displayName } : {}),
    };
  }, [onServer, server.me, device.plan]);

  const after = useCallback(async () => reload(), [reload]);

  const add = useCallback<Store["add"]>(
    async (line, extra) => {
      if (!onServer) return device.save((p) => ({ ...p, lines: [...p.lines, line] }));
      await call("/v1/lines", { method: "POST", body: toServerBody(line, { variationCode: extra?.variationCode ?? null }) });
      await after();
    },
    [onServer, device, call, after],
  );

  const update = useCallback<Store["update"]>(
    async (next, extra) => {
      if (!onServer || !next.onServer) return device.save((p) => ({ ...p, lines: p.lines.map((l) => (l.id === next.id ? next : l)) }));
      const prev = plan.lines.find((l) => l.id === next.id) ?? next;
      const body = toServerPatch(next, prev, extra?.variationCode);
      if (Object.keys(body).length) await call(`/v1/lines/${next.id}`, { method: "PATCH", body });
      await after();
    },
    [onServer, device, plan.lines, call, after],
  );

  const remove = useCallback<Store["remove"]>(
    async (line) => {
      if (!onServer || !line.onServer) return device.save((p) => ({ ...p, lines: p.lines.filter((l) => l.id !== line.id) }));
      await call(`/v1/lines/${line.id}`, { method: "DELETE" });
      await after();
    },
    [onServer, device, call, after],
  );

  const addReading = useCallback<Store["addReading"]>(
    async (line, value) => {
      if (!onServer || !line.onServer) {
        return device.save((p) => ({ ...p, lines: p.lines.map((l) => (l.id === line.id ? { ...l, readings: [...l.readings, { at: new Date().toISOString(), value }].slice(-60) } : l)) }));
      }
      await call(`/v1/lines/${line.id}/readings`, { method: "POST", body: { value } });
      await after();
    },
    [onServer, device, call, after],
  );

  const topUpNow = useCallback<Store["topUpNow"]>(
    async (line) => {
      await call(`/v1/lines/${line.id}/top-up-now`, { method: "POST" });
      await after();
    },
    [call, after],
  );

  const setChannels = useCallback<Store["setChannels"]>(
    async (channels) => {
      if (!onServer) return device.save((p) => ({ ...p, channels }));
      await call("/v1/me", { method: "PATCH", body: { channels } });
      await after();
    },
    [onServer, device, call, after],
  );

  const setName = useCallback<Store["setName"]>(
    async (name) => {
      if (!onServer) return device.save((p) => ({ ...p, ...(name ? { name } : { name: undefined }) }));
      await call("/v1/me", { method: "PATCH", body: { displayName: name } });
      await after();
    },
    [onServer, device, call, after],
  );

  const dropFromDevice = useCallback<Store["dropFromDevice"]>(
    (ids) => {
      if (!ids) device.clear();
      else device.save((p) => ({ ...p, lines: p.lines.filter((l) => !ids.includes(l.id)) }));
      setUnmoved((u) => (ids ? u.filter((x) => !ids.includes(x.line.id)) : []));
    },
    [device],
  );

  const loaded = onServer ? server.me !== null || server.error !== null : device.loaded;
  return { plan, loaded, onServer, add, update, remove, addReading, topUpNow, setChannels, setName, unmoved, dropFromDevice };
}
