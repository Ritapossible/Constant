/**
 * A tiny HTTP health check for hosts that only run services which answer on a port (Pxxl, D-078). Started only when
 * PORT is set, so Render, where the worker has no port, is unchanged. Healthy means the worker started and its
 * order loop finished a pass recently, so a stuck worker is reported, not hidden behind a constant "ok".
 */
import { createServer, type Server } from "node:http";

/** The order loop runs every 10 s; anything quieter than this is stuck. */
export const HEALTHY_WITHIN_MS = 2 * 60_000;

export interface Beats {
  startedAt: Date | null;
  /** When each loop last finished a pass, by name. */
  last: Map<string, Date>;
}

export function newBeats(): Beats {
  return { startedAt: null, last: new Map() };
}

export function healthStatus(b: Beats, now: Date): { ok: boolean; body: Record<string, unknown> } {
  const orders = b.last.get("orders");
  const ok = b.startedAt !== null && orders !== undefined && now.getTime() - orders.getTime() <= HEALTHY_WITHIN_MS;
  return {
    ok,
    body: {
      ok,
      startedAt: b.startedAt?.toISOString() ?? null,
      loops: Object.fromEntries([...b.last].map(([k, v]) => [k, v.toISOString()])),
    },
  };
}

export function startHealthServer(port: number, b: Beats, now: () => Date): Server {
  const server = createServer((req, res) => {
    if (req.method !== "GET" || (req.url !== "/health" && req.url !== "/")) {
      res.writeHead(404).end();
      return;
    }
    const s = healthStatus(b, now());
    res.writeHead(s.ok ? 200 : 503, { "content-type": "application/json" }).end(JSON.stringify(s.body));
  });
  server.listen(port, "0.0.0.0");
  return server;
}
