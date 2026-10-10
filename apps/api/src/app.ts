/**
 * The HTTP API. Signed-in app calls under /v1, partner webhooks under /webhooks.
 *
 * It never spends money: it stores what the user set up, looks decoders up (side-effect free), and records
 * signed funding webhooks. The worker decides and pays (ARCHITECTURE "Shape of the system").
 */
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import {
  DuplicateLine,
  committedToOpenOrders,
  getFundingAccount,
  getLine,
  getMarket,
  getUserByDid,
  hasOpenOrder,
  insertFundingAccount,
  insertLine,
  ledgerSum,
  listLines,
  listOrders,
  lockUser,
  nudgeOrder,
  orderByPartnerRef,
  providerEnabled,
  queueNotice,
  raiseOpsAlert,
  recordFunding,
  saveInboundWebhook,
  setDisplayName,
  updateLine,
  upsertUser,
  usersByCustomerCode,
  vendingEnabled,
  withTx,
  type Db,
  type LineRow,
  type OrderRow,
  type Secrets,
  type UserRow,
} from "@constant/db";
import type { CableProvider, CableVending, Funding, Identity } from "@constant/partners";
import { availableBalance, decideFundingCredit, renewalRunAt } from "@constant/rules";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";

export interface ApiDeps {
  db: Db;
  identity: Identity;
  /** Used only for lookups here. */
  vending: Pick<CableVending, "lookup">;
  funding: Funding;
  secrets: Secrets;
  /** Origins allowed to call /v1 from a browser, e.g. https://constant-units.vercel.app */
  webOrigins: string[];
  /** Shared token in the VTpass callback URL path; VTpass does not sign webhooks. */
  vtpassWebhookToken: string;
  /** Domain for the placeholder email Paystack needs when a user signed in without one. */
  fundingEmailDomain: string;
  now?: () => Date;
  logger?: boolean;
}

declare module "fastify" {
  interface FastifyRequest {
    user: UserRow;
  }
}

const PROVIDERS: CableProvider[] = ["dstv", "gotv", "startimes"];
/** DSTV and GOtv numbers are 10 digits, StarTimes 11; allow 10 to 12 and let the provider decide. */
const SMARTCARD = /^\d{10,12}$/;
const MAX_CAP_MINOR = 50_000_000n; // ₦500,000: far above any bouquet; a typo guard.

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const bad = (code: string, message: string) => new HttpError(400, code, message);

function str(v: unknown, name: string, max = 80): string {
  if (typeof v !== "string" || !v.trim()) throw bad("invalid", `${name} is required`);
  const s = v.trim();
  if (s.length > max) throw bad("invalid", `${name} is too long`);
  return s;
}

function minor(v: unknown, name: string): bigint {
  if (typeof v !== "string" || !/^\d{1,15}$/.test(v)) throw bad("invalid", `${name} must be a whole number of kobo, as a string`);
  return BigInt(v);
}

function provider(v: unknown): CableProvider {
  if (typeof v !== "string" || !PROVIDERS.includes(v as CableProvider)) throw bad("invalid", "provider must be dstv, gotv or startimes");
  return v as CableProvider;
}

function smartcard(v: unknown): string {
  const s = typeof v === "string" ? v.replace(/\s/g, "") : "";
  if (!SMARTCARD.test(s)) throw bad("invalid_smartcard", "Enter the 10 or 11 digit number on your decoder");
  return s;
}

const lineView = (l: LineRow) => ({
  id: l.id,
  kind: l.kind,
  provider: l.provider,
  last4: l.ref_last4,
  customerName: l.customer_name,
  planName: l.plan_name,
  nickname: l.nickname,
  currency: l.currency,
  capMinor: l.cap_minor.toString(),
  status: l.status,
  frozenReason: l.frozen_reason,
  dueAt: l.due_at?.toISOString() ?? null,
  nextRunAt: l.next_run_at?.toISOString() ?? null,
  lastRenewedAt: l.last_renewed_at?.toISOString() ?? null,
});

const orderView = (o: OrderRow) => ({
  id: o.id,
  lineId: o.line_id,
  state: o.state,
  amountMinor: o.amount_minor.toString(),
  feeMinor: o.fee_minor.toString(),
  currency: o.currency,
  createdAt: o.created_at.toISOString(),
  settledAt: o.settled_at?.toISOString() ?? null,
  receiptId: o.receipt_id,
});

export async function buildApp(d: ApiDeps): Promise<FastifyInstance> {
  const now = d.now ?? (() => new Date());
  const app = Fastify({
    logger: d.logger === false ? false : { redact: ["req.headers.authorization", 'req.headers["x-paystack-signature"]'] },
    bodyLimit: 64 * 1024,
    trustProxy: true,
  });

  // Webhook signatures are checked on the exact bytes, so keep the raw body as a string.
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
    try {
      done(null, { raw: body as string, json: body ? JSON.parse(body as string) : {} });
    } catch {
      done(bad("invalid_json", "Body is not JSON"), undefined);
    }
  });
  const json = (req: FastifyRequest) => ((req.body as { json?: Record<string, unknown> } | undefined)?.json ?? {}) as Record<string, unknown>;
  const raw = (req: FastifyRequest) => (req.body as { raw?: string } | undefined)?.raw ?? "";

  await app.register(cors, { origin: d.webOrigins, methods: ["GET", "POST", "PATCH", "DELETE"], allowedHeaders: ["authorization", "content-type"], maxAge: 600 });
  await app.register(rateLimit, { max: 120, timeWindow: "1 minute" });

  app.setErrorHandler((err: Error, req, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send({ error: err.code, message: err.message });
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) return reply.status(status).send({ error: "request", message: err.message });
    req.log.error({ err: { message: err.message } }, "unhandled");
    return reply.status(500).send({ error: "internal", message: "Something went wrong. Try again." });
  });

  app.get("/health", async () => ({ ok: true }));

  // ── Signed-in routes ───────────────────────────────────────────────────────
  await app.register(async (v1) => {
    v1.addHook("preHandler", async (req) => {
      const h = req.headers.authorization;
      const did = h?.startsWith("Bearer ") ? await d.identity.verify(h.slice(7)) : null;
      if (!did) throw new HttpError(401, "unauthenticated", "Sign in again");
      let user = await getUserByDid(d.db, did);
      if (!user || (!user.email && !user.phone_e164)) {
        const contact = await d.identity.user(did).catch(() => ({ email: null, phoneE164: null }));
        user = await upsertUser(d.db, { privyDid: did, email: contact.email, phoneE164: contact.phoneE164 });
      }
      req.user = user;
    });

    v1.get("/me", async (req) => {
      const u = req.user;
      const [sum, committed, account, lines, orders, enabled, market] = await Promise.all([
        ledgerSum(d.db, u.id),
        committedToOpenOrders(d.db, u.id),
        getFundingAccount(d.db, u.id),
        listLines(d.db, u.id),
        listOrders(d.db, u.id),
        vendingEnabled(d.db),
        getMarket(d.db, u.market_code),
      ]);
      return {
        user: { id: u.id, displayName: u.display_name, email: u.email, phone: u.phone_e164 },
        balance: { currency: market.currency, ledgerMinor: sum.toString(), availableMinor: availableBalance(sum, committed).toString() },
        fundingAccount: account && { bankName: account.bank_name, accountNumber: account.account_number, accountName: account.account_name },
        lines: lines.map(lineView),
        orders: orders.map(orderView),
        payments: enabled ? "on" : "paused",
      };
    });

    v1.patch("/me", async (req) => {
      const b = json(req);
      const name = b.displayName === null || b.displayName === "" ? null : str(b.displayName, "displayName", 40);
      await setDisplayName(d.db, req.user.id, name);
      return { displayName: name };
    });

    v1.post("/funding-account", async (req) => {
      const existing = await getFundingAccount(d.db, req.user.id);
      if (existing) return { bankName: existing.bank_name, accountNumber: existing.account_number, accountName: existing.account_name };
      const b = json(req);
      const phone = str(b.phone, "phone", 20).replace(/[^\d+]/g, "");
      if (!/^(\+234|0)[789]\d{9}$/.test(phone)) throw bad("invalid_phone", "Enter a Nigerian mobile number");
      const acct = await d.funding.createDedicatedAccount({
        email: req.user.email ?? `u-${req.user.id}@${d.fundingEmailDomain}`,
        firstName: str(b.firstName, "firstName", 40),
        lastName: str(b.lastName, "lastName", 40),
        phone: phone.startsWith("0") ? `+234${phone.slice(1)}` : phone,
      });
      const saved = await insertFundingAccount(d.db, {
        user_id: req.user.id,
        provider: d.funding.name,
        customer_code: acct.customerCode,
        account_number: acct.accountNumber,
        bank_name: acct.bankName,
        account_name: acct.accountName,
      });
      return { bankName: saved.bank_name, accountNumber: saved.account_number, accountName: saved.account_name };
    });

    v1.post(
      "/cable/lookup",
      { config: { rateLimit: { max: 10, timeWindow: "1 minute", keyGenerator: (req: FastifyRequest) => req.headers.authorization ?? req.ip } } },
      async (req) => {
        const b = json(req);
        const p = provider(b.provider);
        if (!(await providerEnabled(d.db, p, "tv"))) throw bad("provider_off", "This provider is not available yet");
        const r = await d.vending.lookup(p, smartcard(b.smartcard));
        if (!r.ok) {
          throw r.reason === "not_found"
            ? bad("not_found", "We couldn't find that decoder. Check the number and provider.")
            : new HttpError(503, "unreachable", "The provider isn't answering. Try again in a minute.");
        }
        return { customerName: r.customerName, currentPlan: r.currentPlan, renewalAmountMinor: r.renewalAmountMinor?.toString() ?? null, dueAt: r.dueAt?.toISOString() ?? null };
      },
    );

    v1.get("/lines", async (req) => (await listLines(d.db, req.user.id)).map(lineView));

    v1.post("/lines", async (req, reply) => {
      const b = json(req);
      const p = provider(b.provider);
      const card = smartcard(b.smartcard);
      const nickname = str(b.nickname ?? `${p.toUpperCase()} ••${card.slice(-4)}`, "nickname", 40);
      if (!(await providerEnabled(d.db, p, "tv"))) throw bad("provider_off", "This provider is not available yet");

      // The payee is looked up and fixed here, server-side; nothing from the client is trusted for it (rule 5).
      const r = await d.vending.lookup(p, card);
      if (!r.ok) {
        throw r.reason === "not_found" ? bad("not_found", "We couldn't find that decoder.") : new HttpError(503, "unreachable", "The provider isn't answering. Try again in a minute.");
      }
      let dueAt = r.dueAt;
      if (!dueAt) {
        if (typeof b.dueDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(b.dueDate)) throw bad("due_date_needed", "Enter the date your subscription ends");
        dueAt = new Date(`${b.dueDate}T00:00:00+01:00`);
      }
      const renewal = r.renewalAmountMinor;
      const cap = b.capMinor === undefined ? renewal : minor(b.capMinor, "capMinor");
      if (cap === null) throw bad("cap_needed", "Set the most you want to pay per renewal");
      if (cap <= 0n || cap > MAX_CAP_MINOR) throw bad("invalid", "That limit doesn't look right");

      const market = await getMarket(d.db, req.user.market_code);
      const runAt = renewalRunAt(dueAt, market.time_zone);
      try {
        const line = await insertLine(d.db, {
          userId: req.user.id,
          kind: "tv",
          provider: p,
          refCiphertext: d.secrets.encrypt(card),
          refHmac: d.secrets.hmac(`${p}:${card}`),
          refLast4: card.slice(-4),
          customerName: r.customerName,
          planName: r.currentPlan,
          nickname,
          currency: market.currency,
          capMinor: cap,
          dueAt,
          // Due tomorrow or already lapsed: the next scan handles it.
          nextRunAt: runAt < now() ? now() : runAt,
        });
        return reply.status(201).send(lineView(line));
      } catch (err) {
        if (err instanceof DuplicateLine) throw new HttpError(409, "duplicate", "This decoder is already on your account");
        throw err;
      }
    });

    v1.patch("/lines/:id", async (req) => {
      const { id } = req.params as { id: string };
      const line = await getLine(d.db, id, req.user.id);
      if (!line || line.status === "cancelled") throw new HttpError(404, "not_found", "No such bill");
      const b = json(req);
      const patch: Parameters<typeof updateLine>[2] = {};
      if (b.nickname !== undefined) patch.nickname = str(b.nickname, "nickname", 40);
      if (b.capMinor !== undefined) {
        const cap = minor(b.capMinor, "capMinor");
        if (cap <= 0n || cap > MAX_CAP_MINOR) throw bad("invalid", "That limit doesn't look right");
        patch.cap_minor = cap;
      }
      if (b.status !== undefined) {
        if (b.status !== "active" && b.status !== "paused") throw bad("invalid", "status must be active or paused");
        if (line.status === "frozen") throw new HttpError(409, "frozen", "This bill is paused while we check a payment. We'll message you.");
        patch.status = b.status;
      }
      await updateLine(d.db, id, patch);
      return lineView((await getLine(d.db, id, req.user.id))!);
    });

    v1.delete("/lines/:id", async (req, reply) => {
      const { id } = req.params as { id: string };
      const line = await getLine(d.db, id, req.user.id);
      if (!line || line.status === "cancelled") throw new HttpError(404, "not_found", "No such bill");
      if (await hasOpenOrder(d.db, id)) throw new HttpError(409, "in_flight", "A renewal is in progress. Try again in a few minutes.");
      await updateLine(d.db, id, { status: "cancelled", next_run_at: null });
      return reply.status(204).send();
    });

    v1.get("/orders", async (req) => (await listOrders(d.db, req.user.id, 50)).map(orderView));
  }, { prefix: "/v1" });

  // ── Webhooks ───────────────────────────────────────────────────────────────

  app.post("/webhooks/paystack", { config: { rateLimit: false } }, async (req, reply) => {
    const body = raw(req);
    const ok = d.funding.verifySignature(body, req.headers);
    await saveInboundWebhook(d.db, "paystack", ok, body); // stored before anything acts on it (rule 7)
    if (!ok) return reply.status(401).send({ error: "bad_signature" });
    const credit = d.funding.parseCredit(body);
    if (!credit) return { ok: true, ignored: true };

    const users = await usersByCustomerCode(d.db, d.funding.name, credit.customerCode);
    const decision = decideFundingCredit({ signatureValid: ok, isNewEvent: true, amountMinor: credit.amountMinor, matchedSiteIds: users });
    const userId = decision.kind === "credit" ? decision.siteId : null;
    const result = await withTx(d.db, async (tx) => {
      if (userId) await lockUser(tx, userId);
      const r = await recordFunding(tx, {
        provider: d.funding.name,
        eventId: credit.eventId,
        userId,
        amountMinor: credit.amountMinor,
        currency: credit.currency,
        credit: decision.kind === "credit" && credit.currency === "NGN",
        ...(decision.kind === "reject" ? { reason: decision.reason } : credit.currency !== "NGN" ? { reason: "currency" } : {}),
      });
      if (r === "credited" && userId) {
        await queueNotice(tx, {
          key: `notice:funded:${d.funding.name}:${credit.eventId}`,
          userId,
          kind: "funded",
          params: { amountMinor: credit.amountMinor.toString(), balanceMinor: (await ledgerSum(tx, userId)).toString() },
        });
      }
      if (r === "rejected") await raiseOpsAlert(tx, "page", "funding_unmatched", { eventId: credit.eventId, reason: decision.kind === "reject" ? decision.reason : "currency" });
      return r;
    });
    return { ok: true, result };
  });

  app.post("/webhooks/vtpass/:token", { config: { rateLimit: false } }, async (req, reply) => {
    const { token } = req.params as { token: string };
    const body = raw(req);
    const ok = d.vtpassWebhookToken.length >= 16 && token === d.vtpassWebhookToken;
    await saveInboundWebhook(d.db, "vtpass", ok, body);
    if (!ok) return reply.status(404).send();
    // Unsigned: never trusted to settle. It only makes the worker ask the partner now (rule 6).
    const ref = (() => {
      try {
        const b = JSON.parse(body) as { data?: { requestId?: unknown; code?: unknown; content?: { transactions?: { status?: unknown } } } };
        return { id: typeof b.data?.requestId === "string" ? b.data.requestId : null, reversed: b.data?.code === "040" || b.data?.content?.transactions?.status === "reversed" };
      } catch {
        return { id: null, reversed: false };
      }
    })();
    if (ref.id) {
      await nudgeOrder(d.db, ref.id, now());
      if (ref.reversed) {
        const order = await orderByPartnerRef(d.db, ref.id);
        if (order && order.state === "settled") await raiseOpsAlert(d.db, "page", "reversed_after_delivery", { orderId: order.id });
      }
    }
    return { response: "success" };
  });

  return app;
}
