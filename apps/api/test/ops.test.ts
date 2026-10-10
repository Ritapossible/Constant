/**
 * Operator API (D-065): only with the token, every write names its operator and is recorded; needs_human orders are
 * settled exactly once with the right ledger effect.
 */
import { Secrets, freshDatabase, insertLedger, insertLine, ledgerSum, testKeyB64, upsertUser, withTx, insertOrder, transition, receiptId, type Db } from "@constant/db";
import { FakeCableVending, FakeFunding, FakeIdentity } from "@constant/partners";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/index.js";

const TOKEN = "ops-token-0123456789abcdef0123456789";
let db: Db;
let drop: () => Promise<void>;
let app: FastifyInstance;
const NOW = new Date("2026-11-14T08:00:00Z");

beforeAll(async () => {
  ({ db, drop } = await freshDatabase());
  app = await buildApp({
    db, identity: new FakeIdentity(), vending: new FakeCableVending(), funding: new FakeFunding(),
    secrets: new Secrets({ encryption: [{ id: "k1", key: Buffer.from(testKeyB64(), "base64") }], hmac: Buffer.from(testKeyB64(), "base64") }),
    webOrigins: [], vtpassWebhookToken: "x".repeat(20), fundingEmailDomain: "x", now: () => NOW, logger: false, opsToken: TOKEN,
  });
});
afterAll(async () => {
  await app?.close();
  await drop?.();
});

const ops = (method: "GET" | "POST", url: string, body?: unknown, actor: string | null = "ada@constant") =>
  app.inject({
    method,
    url,
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json", ...(actor ? { "x-ops-actor": actor } : {}) },
    ...(body !== undefined ? { payload: JSON.stringify(body) } : {}),
  });

let k = 0;
async function stuckOrder() {
  k += 1;
  const u = await upsertUser(db, { privyDid: `did:privy:ops${k}` });
  await insertLedger(db, { userId: u.id, kind: "fund", amountMinor: 5_000_000n, currency: "NGN", idempotencyKey: `ops:fund:${k}`, actor: "test" });
  const line = await insertLine(db, {
    userId: u.id, kind: "tv", provider: "dstv", refCiphertext: "x", refHmac: `ops${k}`, refLast4: "5678", customerName: null, planName: null,
    nickname: "TV", currency: "NGN", capMinor: 2_500_000n, dueAt: new Date("2026-11-15T00:00:00Z"), nextRunAt: null,
  });
  await db.query("UPDATE lines SET status = 'frozen', frozen_reason = 'payment needs a person to confirm' WHERE id = $1", [line.id]);
  const order = await withTx(db, async (tx) => {
    const o = (await insertOrder(tx, { userId: u.id, lineId: line.id, amountMinor: 1_995_000n, feeMinor: 0n, currency: "NGN", idempotencyKey: `ops:o:${k}`, scheduledFor: NOW, partner: "fake", receiptId: receiptId() }))!;
    const v = await transition(tx, o, { type: "start" }, { partner_ref: `REF${k}` }, "test");
    return transition(tx, v, { type: "ambiguous" }, {}, "test");
  });
  return { user: u, line, order };
}

describe("ops API", () => {
  it("refuses without the token, and refuses writes without a named operator", async () => {
    expect((await app.inject({ method: "GET", url: "/ops/summary" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/ops/summary", headers: { authorization: "Bearer wrong" } })).statusCode).toBe(401);
    expect((await ops("POST", "/ops/flags/vending_enabled", { value: true, note: "go live" }, null)).statusCode).toBe(400);
    expect((await ops("GET", "/ops/summary")).json().flags).toMatchObject({ vending_enabled: false, payouts_enabled: false });
  });

  it("delivered: writes the vend once, settles toward notifying, moves the line on, records who", async () => {
    const { user, line, order } = await stuckOrder();
    expect((await ops("GET", "/ops/orders/needs-human")).json().map((o: { id: string }) => o.id)).toContain(order.id);
    expect((await ops("POST", `/ops/orders/${order.id}/resolve`, { outcome: "delivered" })).json().error).toBe("note_required");
    const r = await ops("POST", `/ops/orders/${order.id}/resolve`, { outcome: "delivered", note: "VTpass dashboard shows delivered" });
    expect(r.json()).toEqual({ outcome: "delivered" });
    expect(await ledgerSum(db, user.id)).toBe(5_000_000n - 1_995_000n);
    expect((await db.query("SELECT state FROM orders WHERE id = $1", [order.id])).rows[0].state).toBe("notifying");
    expect((await db.query("SELECT status FROM lines WHERE id = $1", [line.id])).rows[0].status).toBe("active");
    expect((await ops("POST", `/ops/orders/${order.id}/resolve`, { outcome: "delivered", note: "again please" })).statusCode).toBe(409);
    const audit = await db.query("SELECT actor, action FROM ops_actions WHERE target = $1", [order.id]);
    expect(audit.rows).toEqual([{ actor: "ops:ada@constant", action: "resolve_order" }]);
  });

  it("not delivered: no money moves, the line is retried", async () => {
    const { user, line, order } = await stuckOrder();
    await ops("POST", `/ops/orders/${order.id}/resolve`, { outcome: "not_delivered", note: "VTpass says no such transaction" });
    expect(await ledgerSum(db, user.id)).toBe(5_000_000n);
    expect((await db.query("SELECT state FROM orders WHERE id = $1", [order.id])).rows[0].state).toBe("failed");
    expect((await db.query("SELECT status, next_run_at FROM lines WHERE id = $1", [line.id])).rows[0]).toMatchObject({ status: "active" });
  });

  it("a user frozen by screening needs an explicit compliance confirmation", async () => {
    const u = await upsertUser(db, { privyDid: "did:privy:ops-screen" });
    await db.query("UPDATE users SET status = 'frozen', frozen_reason = 'screening' WHERE id = $1", [u.id]);
    expect((await ops("POST", `/ops/users/${u.id}/unfreeze`, { note: "looked fine" })).json().error).toBe("screening");
    expect((await ops("POST", `/ops/users/${u.id}/unfreeze`, { note: "compliance review #12 cleared", screeningCleared: true })).json()).toEqual({ ok: true });
  });

  it("switches flags only from the known list, with a reason", async () => {
    expect((await ops("POST", "/ops/flags/anything", { value: true, note: "x".repeat(10) })).statusCode).toBe(404);
    expect((await ops("POST", "/ops/flags/vending_enabled", { value: true, note: "sandbox checks passed" })).json()).toEqual({ key: "vending_enabled", value: true });
    const f = await db.query("SELECT changed_by, reason FROM system_flags WHERE key = 'vending_enabled'");
    expect(f.rows[0]).toEqual({ changed_by: "ops:ada@constant", reason: "sandbox checks passed" });
  });

  it("lists and resolves alerts; requests a reconciliation run", async () => {
    await db.query("INSERT INTO ops_alerts (severity, kind, detail) VALUES ('page', 'test_alert', '{}')");
    const open = (await ops("GET", "/ops/alerts")).json();
    const a = open.find((x: { kind: string }) => x.kind === "test_alert");
    expect((await ops("POST", `/ops/alerts/${a.id}/resolve`, { note: "handled it" })).json()).toEqual({ ok: true });
    expect((await ops("POST", "/ops/reconcile", {})).json().requested).toBeTruthy();
  });
});

