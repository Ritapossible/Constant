import { afterAll, describe, expect, it } from "vitest";
import { HEALTHY_WITHIN_MS, healthStatus, newBeats, startHealthServer } from "../src/health.js";

describe("worker health check (D-078)", () => {
  const t0 = new Date("2026-10-19T09:00:00Z");

  it("is unhealthy until the worker has started and the order loop has run", () => {
    const b = newBeats();
    expect(healthStatus(b, t0).ok).toBe(false);
    b.startedAt = t0;
    expect(healthStatus(b, t0).ok).toBe(false);
    b.last.set("orders", t0);
    expect(healthStatus(b, t0).ok).toBe(true);
  });

  it("turns unhealthy when the order loop stops finishing passes", () => {
    const b = newBeats();
    b.startedAt = t0;
    b.last.set("orders", t0);
    expect(healthStatus(b, new Date(t0.getTime() + HEALTHY_WITHIN_MS)).ok).toBe(true);
    expect(healthStatus(b, new Date(t0.getTime() + HEALTHY_WITHIN_MS + 1)).ok).toBe(false);
  });

  const b = newBeats();
  const server = startHealthServer(0, b, () => t0);
  afterAll(() => new Promise<void>((r) => server.close(() => r())));
  const url = async (path: string) => {
    await new Promise((r) => (server.listening ? r(null) : server.once("listening", r)));
    const port = (server.address() as { port: number }).port;
    return fetch(`http://127.0.0.1:${port}${path}`);
  };

  it("answers 503 then 200 on /health over HTTP, and 404 elsewhere", async () => {
    expect((await url("/health")).status).toBe(503);
    b.startedAt = t0;
    b.last.set("orders", t0);
    const ok = await url("/health");
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ ok: true, loops: { orders: t0.toISOString() } });
    expect((await url("/nope")).status).toBe(404);
  });
});
