/**
 * VTpass (D-024): cable TV renewal. Docs: vtpass.com/documentation (DSTV/GOtv/StarTimes, response codes,
 * transaction-update webhook). GET uses api-key + public-key, POST uses api-key + secret-key.
 *
 * - request_id: 12+ chars, starting with today's date and time in Africa/Lagos (YYYYMMDDHHII).
 * - "000" means processed: read content.transactions.status (initiated | pending | delivered).
 * - Timeouts and anything unexpected are pending: requery with the same request_id. Never pay twice.
 * - Webhooks are not signed, so they only tell us which request to requery.
 */
import { localParts } from "@constant/rules";
import { fetchJson, minorToNaira, nairaToMinor, type Fetch } from "./http.js";
import type { CablePlan, CableProvider, CableVending, DecoderLookup, VendOutcome } from "./types.js";

export interface VtpassConfig {
  baseUrl: string; // https://sandbox.vtpass.com/api or https://vtpass.com/api
  apiKey: string;
  publicKey: string;
  secretKey: string;
  fetch?: Fetch;
  timeoutMs?: number;
}

const FAILED = new Set(["016", "091", "010", "011", "012", "013", "017", "018", "019", "021", "022", "023", "024", "027", "028", "030", "034", "035", "085", "087"]);
const PENDING = new Set(["099", "089", "001"]);

/** Maps a pay or requery response to an outcome. Exported for tests. */
export function vtpassOutcome(status: number, body: unknown): VendOutcome {
  const b = (body ?? {}) as { code?: unknown; response_description?: unknown; content?: { transactions?: { status?: unknown; transactionId?: unknown } } };
  const code = typeof b.code === "string" ? b.code : typeof b.code === "number" ? String(b.code).padStart(3, "0") : "";
  const desc = typeof b.response_description === "string" ? b.response_description : `http ${status}`;
  if (status >= 500 || !code) return { kind: "unknown", detail: desc };
  if (code === "000") {
    const s = String(b.content?.transactions?.status ?? "").toLowerCase();
    const txn = b.content?.transactions?.transactionId;
    if (s === "delivered") return { kind: "delivered", partnerTxnId: txn == null ? null : String(txn) };
    if (s === "reversed") return { kind: "reversed", detail: desc };
    if (s === "failed") return { kind: "failed", code, detail: desc };
    return { kind: "pending", detail: s || desc };
  }
  if (code === "040") return { kind: "reversed", detail: desc };
  if (code === "015") return { kind: "not_found" };
  if (PENDING.has(code)) return { kind: "pending", detail: desc };
  if (FAILED.has(code)) return { kind: "failed", code, detail: desc };
  return { kind: "unknown", detail: `${code} ${desc}` }; // 014, 044, 083 and anything new: ask again or a person
}

/** "2026-11-15", "2026-11-15T00:00:00", "15 Nov 2026" → the start of that day in Lagos. */
export function parseDueDate(v: unknown): Date | null {
  if (typeof v !== "string" || !v.trim()) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(v.trim());
  let y: number, m: number, d: number;
  if (iso) {
    [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  } else {
    const t = Date.parse(`${v} 12:00 UTC`);
    if (Number.isNaN(t)) return null;
    const p = new Date(t);
    [y, m, d] = [p.getUTCFullYear(), p.getUTCMonth() + 1, p.getUTCDate()];
  }
  if (!y || m < 1 || m > 12 || d < 1 || d > 31) return null;
  // Lagos is UTC+1 all year (no DST): local midnight is 23:00 UTC the day before.
  return new Date(Date.UTC(y, m - 1, d) - 3_600_000);
}

export class Vtpass implements CableVending {
  readonly name = "vtpass";
  private readonly f: Fetch;

  constructor(private readonly c: VtpassConfig) {
    this.f = c.fetch ?? fetch;
  }

  private get(path: string) {
    return fetchJson(this.f, `${this.c.baseUrl}/${path}`, {
      method: "GET",
      headers: { "api-key": this.c.apiKey, "public-key": this.c.publicKey },
      timeoutMs: this.c.timeoutMs ?? 30_000,
    });
  }

  private post(path: string, body: Record<string, unknown>) {
    return fetchJson(this.f, `${this.c.baseUrl}/${path}`, {
      method: "POST",
      headers: { "api-key": this.c.apiKey, "secret-key": this.c.secretKey, "content-type": "application/json" },
      body: JSON.stringify(body),
      timeoutMs: this.c.timeoutMs ?? 45_000,
    });
  }

  async plans(provider: CableProvider): Promise<CablePlan[]> {
    const { body } = await this.get(`service-variations?serviceID=${provider}`);
    const content = (body as { content?: { variations?: unknown[]; varations?: unknown[] } })?.content;
    const list = (content?.variations ?? content?.varations ?? []) as { variation_code?: string; name?: string; variation_amount?: unknown }[];
    return list.flatMap((v) => {
      const amount = nairaToMinor(v.variation_amount);
      return v.variation_code && v.name && amount !== null ? [{ code: v.variation_code, name: v.name, amountMinor: amount }] : [];
    });
  }

  async lookup(provider: CableProvider, smartcard: string): Promise<DecoderLookup> {
    let res;
    try {
      res = await this.post("merchant-verify", { billersCode: smartcard, serviceID: provider });
    } catch {
      return { ok: false, reason: "unreachable" };
    }
    const b = res.body as { code?: string; content?: Record<string, unknown> };
    const c = b?.content ?? {};
    if (b?.code === "030" || res.status >= 500) return { ok: false, reason: "unreachable" };
    const name = typeof c.Customer_Name === "string" ? c.Customer_Name.trim() : "";
    if (!name || c.error) return { ok: false, reason: "not_found" };
    return {
      ok: true,
      customerName: name,
      currentPlan: typeof c.Current_Bouquet === "string" ? c.Current_Bouquet : null,
      renewalAmountMinor: nairaToMinor(c.Renewal_Amount),
      dueAt: parseDueDate(c.Due_Date),
    };
  }

  async renew(req: { requestId: string; provider: CableProvider; smartcard: string; amountMinor: bigint; phone: string }): Promise<VendOutcome> {
    const body: Record<string, unknown> = {
      request_id: req.requestId,
      serviceID: req.provider,
      billersCode: req.smartcard,
      amount: minorToNaira(req.amountMinor),
      phone: req.phone,
    };
    // DSTV and GOtv distinguish renew from change; StarTimes has no renew flag.
    if (req.provider !== "startimes") body.subscription_type = "renew";
    try {
      const res = await this.post("pay", body);
      return vtpassOutcome(res.status, res.body);
    } catch (err) {
      return { kind: "unknown", detail: (err as Error).message };
    }
  }

  async requery(requestId: string): Promise<VendOutcome> {
    try {
      const res = await this.post("requery", { request_id: requestId });
      return vtpassOutcome(res.status, res.body);
    } catch (err) {
      return { kind: "unknown", detail: (err as Error).message };
    }
  }

  newRequestId(orderId: string, now: Date): string {
    const p = localParts(now, "Africa/Lagos");
    const two = (n: number) => String(n).padStart(2, "0");
    return `${p.year}${two(p.month)}${two(p.day)}${two(p.hour)}${two(p.minute)}${orderId.replace(/-/g, "").slice(0, 20)}`;
  }

  /** GET /api/balance → {"code":1,"contents":{"balance":1081.8199999998}} (naira, a float). Rounded down. */
  async floatBalance(): Promise<bigint> {
    const { status, body } = await this.get("balance");
    const b = body as { code?: unknown; contents?: { balance?: unknown } };
    const v = b?.contents?.balance;
    if (status !== 200 || Number(b?.code) !== 1 || typeof v !== "number" || !Number.isFinite(v) || v < 0) {
      throw new Error(`vtpass balance unavailable (${status})`);
    }
    // Advisory only (it gates charging, never sizes a payment): floor to the kobo so it's never overstated.
    return BigInt(Math.floor(v * 100 + 1e-6));
  }

  webhookRequestId(rawBody: string): string | null {
    try {
      const b = JSON.parse(rawBody) as { type?: string; data?: { requestId?: unknown } };
      return b.type === "transaction-update" && typeof b.data?.requestId === "string" ? b.data.requestId : null;
    } catch {
      return null;
    }
  }
}
