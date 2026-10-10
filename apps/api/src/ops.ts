/**
 * Operator API (D-065). Bearer OPS_TOKEN, and every write names its operator in `x-ops-actor` and lands in
 * ops_actions. This is how a person settles what the system refused to guess: an order in needs_human, a frozen
 * line or user, a tripped switch.
 */
import {
  chargeForOrder,
  getMarket,
  getUser,
  insertLedger,
  listAlerts,
  lockLine,
  lockOrder,
  lockUser,
  logOpsAction,
  opsSummary,
  queueNotice,
  requestReconciliation,
  resolveAlert,
  setFlag,
  setLineFunding,
  transition,
  updateCharge,
  updateLine,
  withTx,
  writeVendEntries,
  type Db,
} from "@constant/db";
import { nextDueAfter, renewalRunAt } from "@constant/rules";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { timingSafeEqual } from "node:crypto";

const FLAGS = ["vending_enabled", "dollar_charges_enabled", "payouts_enabled"] as const;

class OpsError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function registerOps(app: FastifyInstance, d: { db: Db; opsToken: string; now: () => Date }, body: (req: FastifyRequest) => Record<string, unknown>) {
  if (d.opsToken.length < 32) throw new Error("OPS_TOKEN must be at least 32 characters");
  const expected = Buffer.from(d.opsToken);

  await app.register(
    async (ops) => {
      ops.addHook("preHandler", async (req) => {
        const h = req.headers.authorization ?? "";
        const given = Buffer.from(h.startsWith("Bearer ") ? h.slice(7) : "");
        if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new OpsError(401, "unauthenticated", "Not an operator");
        if (req.method !== "GET") {
          const actor = req.headers["x-ops-actor"];
          if (typeof actor !== "string" || actor.trim().length < 2) throw new OpsError(400, "actor_required", "Say who you are in x-ops-actor");
        }
      });
      ops.setErrorHandler((err: Error, _req, reply) => {
        if (err instanceof OpsError) return reply.status(err.status).send({ error: err.code, message: err.message });
        return reply.status(500).send({ error: "internal", message: err.message });
      });
      const actor = (req: FastifyRequest) => `ops:${String(req.headers["x-ops-actor"]).trim().slice(0, 80)}`;
      const note = (req: FastifyRequest) => {
        const n = body(req).note;
        if (typeof n !== "string" || n.trim().length < 5) throw new OpsError(400, "note_required", "Write a short note saying why (5+ characters)");
        return n.trim().slice(0, 500);
      };

      ops.get("/summary", async () => opsSummary(d.db));

      ops.get("/alerts", async (req) => {
        const open = (req.query as { open?: string }).open !== "0";
        return (await listAlerts(d.db, open)).map((a) => ({ ...a, id: a.id.toString() }));
      });

      ops.post("/alerts/:id/resolve", async (req) => {
        const { id } = req.params as { id: string };
        const who = actor(req);
        const n = note(req);
        if (!(await resolveAlert(d.db, id, who))) throw new OpsError(404, "not_found", "No open alert with that id");
        await logOpsAction(d.db, who, "resolve_alert", id, { note: n });
        return { ok: true };
      });

      ops.get("/orders/needs-human", async () => {
        const r = await d.db.query(
          `SELECT o.id, o.user_id, o.line_id, o.funding, o.amount_minor::text, o.partner_ref, o.error, o.updated_at, c.status AS charge_status, c.tx_hash AS charge_tx
           FROM orders o LEFT JOIN charges c ON c.order_id = o.id WHERE o.state = 'needs_human' ORDER BY o.updated_at`,
        );
        return r.rows;
      });

      /**
       * Settle an order a person has checked at the partner (and, for dollar orders, on Base).
       * - delivered: the bill was paid. Writes the vend entries once, tells the user, moves the line to next month.
       * - not_delivered: nothing was paid at the partner. No ledger entry; the line is unfrozen and retried.
       * - For a dollar charge nobody could confirm (never vended): `charged` says whether the USDC left the user's
       *   account. If it did, its naira is credited and the line switches to naira so the user isn't charged twice.
       */
      ops.post("/orders/:id/resolve", async (req) => {
        const { id } = req.params as { id: string };
        const b = body(req);
        const who = actor(req);
        const n = note(req);
        const now = d.now();
        const result = await withTx(d.db, async (tx) => {
          const order = await lockOrder(tx, id);
          if (order.state !== "needs_human") throw new OpsError(409, "not_needs_human", `Order is ${order.state}`);
          const user = await lockUser(tx, order.user_id);
          const line = await lockLine(tx, order.line_id);
          const charge = order.funding === "usdc_base" ? await chargeForOrder(tx, order.id) : null;

          if (charge && charge.status !== "confirmed") {
            if (typeof b.charged !== "boolean") throw new OpsError(400, "charged_required", "Say whether the USDC charge happened on Base (charged: true/false)");
            await updateCharge(tx, charge.id, { status: b.charged ? "confirmed" : "failed", confirmed_at: b.charged ? now : null, tx_raw: null, error: `resolved by ${who}` });
            if (b.charged) {
              await insertLedger(tx, {
                userId: order.user_id, lineId: order.line_id, orderId: order.id, kind: "fund", amountMinor: charge.naira_minor,
                currency: order.currency, idempotencyKey: `ledger:fund:charge:${charge.id}`, externalRef: charge.tx_hash, actor: who,
              });
              await setLineFunding(tx, line.id, "naira");
            }
            await transition(tx, order, { type: "resolved_failed" }, { error: `resolved: ${n}` }, who, { charged: b.charged, note: n });
            await updateLine(tx, line.id, { status: "active", frozen_reason: null, next_run_at: now });
            return { outcome: b.charged ? "charge_credited" : "charge_failed" };
          }

          if (b.outcome === "delivered") {
            const ref = order.partner_ref ?? `manual:${order.id}`;
            await writeVendEntries(tx, order, ref);
            const stored = await transition(tx, order, { type: "resolved_token" }, { error: null }, who, { note: n });
            await transition(tx, stored, { type: "notify_start" }, {}, who);
            const market = await getMarket(tx, user.market_code);
            const due = nextDueAfter(line.due_at ?? order.scheduled_for ?? now, market.time_zone);
            await updateLine(tx, line.id, { status: "active", frozen_reason: null, last_renewed_at: now, due_at: due, next_run_at: renewalRunAt(due, market.time_zone) });
            await queueNotice(tx, { key: `notice:renewed:${order.id}`, userId: order.user_id, lineId: line.id, orderId: order.id, kind: "renewed", params: { line: line.nickname, amountMinor: order.amount_minor.toString(), dueAt: due.toISOString() } });
            return { outcome: "delivered" };
          }
          if (b.outcome === "not_delivered") {
            await transition(tx, order, { type: "resolved_failed" }, { error: `resolved: ${n}` }, who, { note: n });
            await updateLine(tx, line.id, { status: "active", frozen_reason: null, next_run_at: now });
            return { outcome: "not_delivered" };
          }
          throw new OpsError(400, "outcome_required", "outcome must be delivered or not_delivered");
        });
        await logOpsAction(d.db, who, "resolve_order", id, { ...result, note: n });
        return result;
      });

      ops.post("/lines/:id/unfreeze", async (req) => {
        const { id } = req.params as { id: string };
        const who = actor(req);
        const n = note(req);
        const open = await d.db.query("SELECT 1 FROM orders WHERE line_id = $1 AND state = 'needs_human'", [id]);
        if (open.rowCount) throw new OpsError(409, "order_open", "Resolve this line's needs_human order first");
        const r = await d.db.query("UPDATE lines SET status = 'active', frozen_reason = NULL, updated_at = now() WHERE id = $1 AND status = 'frozen'", [id]);
        if (!r.rowCount) throw new OpsError(404, "not_frozen", "No frozen line with that id");
        await logOpsAction(d.db, who, "unfreeze_line", id, { note: n });
        return { ok: true };
      });

      ops.post("/users/:id/unfreeze", async (req) => {
        const { id } = req.params as { id: string };
        const who = actor(req);
        const n = note(req);
        const user = await getUser(d.db, id);
        if (!user || user.status !== "frozen") throw new OpsError(404, "not_frozen", "No frozen user with that id");
        const frozen = await d.db.query<{ frozen_reason: string | null }>("SELECT frozen_reason FROM users WHERE id = $1", [id]);
        if (frozen.rows[0]?.frozen_reason === "screening" && body(req).screeningCleared !== true) {
          throw new OpsError(400, "screening", "Frozen by sanctions screening: confirm with screeningCleared: true after compliance review");
        }
        await d.db.query("UPDATE users SET status = 'active', frozen_reason = NULL, updated_at = now() WHERE id = $1", [id]);
        await logOpsAction(d.db, who, "unfreeze_user", id, { note: n, reason: frozen.rows[0]?.frozen_reason });
        return { ok: true };
      });

      ops.post("/flags/:key", async (req) => {
        const { key } = req.params as { key: string };
        if (!FLAGS.includes(key as (typeof FLAGS)[number])) throw new OpsError(404, "unknown_flag", `Flags: ${FLAGS.join(", ")}`);
        const b = body(req);
        if (typeof b.value !== "boolean") throw new OpsError(400, "value_required", "value must be true or false");
        const who = actor(req);
        const n = note(req);
        await setFlag(d.db, key, b.value, who, n);
        await logOpsAction(d.db, who, "set_flag", key, { value: b.value, note: n });
        return { key, value: b.value };
      });

      ops.post("/reconcile", async (req) => {
        const who = actor(req);
        const id = await requestReconciliation(d.db, who);
        await logOpsAction(d.db, who, "request_reconciliation", id.toString());
        return { requested: id.toString() };
      });
    },
    { prefix: "/ops" },
  );
}
