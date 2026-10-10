import { createHmac, timingSafeEqual } from "node:crypto";
/**
 * Paycrest (RAILS): the USDC → NGN rate on Base, used to convert a naira bill into a dollar charge.
 * Public endpoint, checked live 2026-10-10: GET /v1/rates/USDC/{amount}/NGN?network=base →
 * {"status":"success","data":"1352.34"} (naira per USDC). The off-ramp order API comes with the treasury step.
 */
import { fetchJson, type Fetch } from "./http.js";

export interface RateQuote {
  /** Naira per 1 USDC as the provider wrote it, e.g. "1352.34". Parse with parseRate in packages/rules. */
  ngnPerUsdc: string;
  fetchedAt: Date;
}

export interface RateSource {
  usdcToNgn(amountUsdc: number): Promise<RateQuote>;
}

export class PaycrestRates implements RateSource {
  private readonly f: Fetch;
  constructor(
    private readonly baseUrl = "https://api.paycrest.io",
    f?: Fetch,
  ) {
    this.f = f ?? fetch;
  }

  async usdcToNgn(amountUsdc: number): Promise<RateQuote> {
    const amount = Math.max(1, Math.ceil(amountUsdc));
    const res = await fetchJson(this.f, `${this.baseUrl}/v1/rates/USDC/${amount}/NGN?network=base`, { method: "GET", timeoutMs: 10_000 });
    const b = res.body as { status?: string; data?: unknown };
    if (res.status !== 200 || b?.status !== "success" || typeof b.data !== "string" || !/^\d+(\.\d+)?$/.test(b.data)) {
      throw new Error(`paycrest rate unavailable (${res.status})`);
    }
    return { ngnPerUsdc: b.data, fetchedAt: new Date() };
  }
}

export class FakeRates implements RateSource {
  constructor(public ngnPerUsdc = "1352.34") {}
  fail = false;
  async usdcToNgn(): Promise<RateQuote> {
    if (this.fail) throw new Error("rates down");
    return { ngnPerUsdc: this.ngnPerUsdc, fetchedAt: new Date() };
  }
}

// ── Sender API: off-ramp orders (D-068) ─────────────────────────────────────────
// docs.paycrest.io, checked 2026-10-10: POST /v1/sender/orders with header API-Key →
// {data: {id, amount, receiveAddress, validUntil, senderFee, transactionFee, reference}};
// GET /v1/sender/orders/:id; webhooks signed with HMAC-SHA256 (hex) of the raw body, header X-Paycrest-Signature.


export interface OfframpRecipient {
  institution: string;
  accountIdentifier: string;
  accountName: string;
  memo: string;
}

export interface OfframpOrder {
  id: string;
  receiveAddress: string;
  /** Total USDC to send: amount plus the sender and transaction fees, in micro-units. */
  sendMicro: bigint;
  validUntil: Date | null;
}

export type OfframpStatus = "pending" | "settled" | "refunded" | "expired";

export interface Offramp {
  createOrder(o: { amountMicro: bigint; rate: string; reference: string; returnAddress: string; recipient: OfframpRecipient }): Promise<OfframpOrder>;
  orderStatus(id: string): Promise<OfframpStatus>;
  verifyWebhook(rawBody: string, signature: string | undefined): boolean;
  parseWebhook(rawBody: string): { orderId: string; reference: string | null; status: OfframpStatus } | null;
}

const toMicro = (v: unknown): bigint => {
  const s = typeof v === "number" ? v.toFixed(6) : String(v ?? "");
  const m = /^(\d+)(?:\.(\d{1,6})\d*)?$/.exec(s);
  if (!m) throw new Error(`bad amount ${s}`);
  return BigInt(m[1]!) * 1_000_000n + BigInt((m[2] ?? "").padEnd(6, "0"));
};
const microToDecimal = (m: bigint) => `${m / 1_000_000n}.${(m % 1_000_000n).toString().padStart(6, "0")}`;

export function offrampStatus(s: unknown): OfframpStatus {
  const v = String(s ?? "").toLowerCase();
  if (v === "settled" || v === "validated") return "settled"; // validated: the provider has paid out the naira
  if (v === "refunded") return "refunded";
  if (v === "expired") return "expired";
  return "pending";
}

export class PaycrestSender implements Offramp {
  private readonly f: Fetch;
  constructor(
    private readonly apiKey: string,
    private readonly apiSecret: string,
    private readonly baseUrl = "https://api.paycrest.io",
    f?: Fetch,
  ) {
    this.f = f ?? fetch;
  }

  async createOrder(o: { amountMicro: bigint; rate: string; reference: string; returnAddress: string; recipient: OfframpRecipient }): Promise<OfframpOrder> {
    const res = await fetchJson(this.f, `${this.baseUrl}/v1/sender/orders`, {
      method: "POST",
      headers: { "API-Key": this.apiKey, "content-type": "application/json" },
      body: JSON.stringify({ amount: Number(microToDecimal(o.amountMicro)), token: "USDC", rate: Number(o.rate), network: "base", recipient: o.recipient, reference: o.reference, returnAddress: o.returnAddress }),
      timeoutMs: 30_000,
    });
    const d = (res.body as { data?: Record<string, unknown> })?.data;
    if (res.status >= 300 || !d?.id || !d.receiveAddress) throw new Error(`paycrest order failed (${res.status}): ${(res.body as { message?: string })?.message ?? ""}`);
    const send = toMicro(d.amount) + toMicro(d.senderFee ?? 0) + toMicro(d.transactionFee ?? 0);
    return { id: String(d.id), receiveAddress: String(d.receiveAddress), sendMicro: send, validUntil: d.validUntil ? new Date(String(d.validUntil)) : null };
  }

  async orderStatus(id: string): Promise<OfframpStatus> {
    const res = await fetchJson(this.f, `${this.baseUrl}/v1/sender/orders/${encodeURIComponent(id)}`, { method: "GET", headers: { "API-Key": this.apiKey }, timeoutMs: 15_000 });
    if (res.status !== 200) throw new Error(`paycrest order lookup failed (${res.status})`);
    return offrampStatus((res.body as { data?: { status?: unknown } })?.data?.status);
  }

  verifyWebhook(rawBody: string, signature: string | undefined): boolean {
    const sig = (signature ?? "").trim().toLowerCase();
    const expected = createHmac("sha256", this.apiSecret.trim()).update(rawBody).digest("hex");
    // Compare the hex strings as UTF-8, as Paycrest's docs specify.
    return sig.length === expected.length && timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  }

  parseWebhook(rawBody: string) {
    try {
      const b = JSON.parse(rawBody) as { event?: string; data?: { id?: unknown; reference?: unknown; status?: unknown } };
      if (!b.data?.id) return null;
      const fromEvent = b.event?.startsWith("payment_order.") ? b.event.slice("payment_order.".length) : b.data.status;
      return { orderId: String(b.data.id), reference: typeof b.data.reference === "string" ? b.data.reference : null, status: offrampStatus(fromEvent) };
    } catch {
      return null;
    }
  }
}

export class FakeOfframp implements Offramp {
  orders = new Map<string, { amountMicro: bigint; reference: string; status: OfframpStatus; receiveAddress: string }>();
  fail = false;
  feeMicro = 500_000n;
  constructor(readonly secret = "pc-secret") {}
  async createOrder(o: { amountMicro: bigint; reference: string }) {
    if (this.fail) throw new Error("paycrest down");
    const id = `ord_${Math.random().toString(36).slice(2, 10)}`;
    const receiveAddress = `0x${(this.orders.size + 1).toString(16).padStart(40, "e")}`;
    this.orders.set(id, { amountMicro: o.amountMicro, reference: o.reference, status: "pending", receiveAddress });
    return { id, receiveAddress, sendMicro: o.amountMicro + this.feeMicro, validUntil: null };
  }
  async orderStatus(id: string) {
    return this.orders.get(id)?.status ?? "pending";
  }
  sign(raw: string) {
    return createHmac("sha256", this.secret).update(raw).digest("hex");
  }
  verifyWebhook(raw: string, sig: string | undefined) {
    return sig === this.sign(raw);
  }
  parseWebhook(raw: string) {
    return new PaycrestSender("k", this.secret).parseWebhook(raw);
  }
}
