/**
 * Paystack dedicated virtual accounts (D-022): each user gets their own account number; transfers into it
 * arrive as a signed `charge.success` webhook with channel `dedicated_nuban`. The signature is
 * HMAC-SHA512 of the raw body with the secret key, in `x-paystack-signature`. Checkout (D-075): card, USSD, QR and
 * pay-with-transfer top-ups by our own reference; their `charge.success` has any other channel.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { fetchJson, type Fetch } from "./http.js";
import type { Bank, Checkout, CheckoutResult, CheckoutStart, DedicatedAccount, Funding, FundingCredit, Payouts, TransferEvent, TransferOutcome } from "./types.js";

export interface PaystackConfig {
  secretKey: string;
  /** "wema-bank" or "titan-paystack" live; "test-bank" with a test key. */
  preferredBank: string;
  baseUrl?: string;
  fetch?: Fetch;
}

export class PaystackError extends Error {}

export class Paystack implements Funding, Payouts, Checkout {
  readonly name = "paystack";
  private readonly f: Fetch;
  private readonly base: string;

  constructor(private readonly c: PaystackConfig) {
    this.f = c.fetch ?? fetch;
    this.base = c.baseUrl ?? "https://api.paystack.co";
  }

  private async post(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const res = await fetchJson(this.f, `${this.base}${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.c.secretKey}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      timeoutMs: 30_000,
    });
    const b = res.body as { status?: boolean; message?: string; data?: Record<string, unknown> };
    if (!b?.status || !b.data) throw new PaystackError(b?.message ?? `paystack ${path} failed (${res.status})`);
    return b.data;
  }

  private async get(path: string): Promise<{ status: number; body: { status?: boolean; message?: string; data?: unknown } }> {
    const res = await fetchJson(this.f, `${this.base}${path}`, { method: "GET", headers: { authorization: `Bearer ${this.c.secretKey}` }, timeoutMs: 20_000 });
    return { status: res.status, body: (res.body ?? {}) as { status?: boolean; message?: string; data?: unknown } };
  }

  async banks(): Promise<Bank[]> {
    const { body } = await this.get("/bank?currency=NGN&perPage=200");
    const list = (Array.isArray(body.data) ? body.data : []) as { code?: string; name?: string; active?: boolean }[];
    return list.filter((b) => b.code && b.name && b.active !== false).map((b) => ({ code: b.code!, name: b.name! }));
  }

  async resolveAccount(bankCode: string, accountNumber: string): Promise<string | null> {
    const { status, body } = await this.get(`/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`);
    const name = (body.data as { account_name?: string } | undefined)?.account_name;
    if (status === 200 && body.status && name) return name;
    if (status === 422 || status === 400) return null;
    throw new PaystackError(`account lookup unavailable (${status})`);
  }

  async createRecipient(r: { name: string; bankCode: string; accountNumber: string }): Promise<string> {
    const d = await this.post("/transferrecipient", { type: "nuban", name: r.name, account_number: r.accountNumber, bank_code: r.bankCode, currency: "NGN" });
    const code = String(d.recipient_code ?? "");
    if (!code) throw new PaystackError("paystack: no recipient code");
    return code;
  }

  async transfer(t: { reference: string; recipientCode: string; amountMinor: bigint; reason: string }): Promise<TransferOutcome> {
    let res;
    try {
      res = await fetchJson(this.f, `${this.base}/transfer`, {
        method: "POST",
        headers: { authorization: `Bearer ${this.c.secretKey}`, "content-type": "application/json" },
        body: JSON.stringify({ source: "balance", amount: Number(t.amountMinor), recipient: t.recipientCode, reference: t.reference, reason: t.reason }),
        timeoutMs: 30_000,
      });
    } catch (err) {
      return { kind: "unknown", detail: (err as Error).message };
    }
    return transferOutcome(res.status, res.body);
  }

  async verifyTransfer(reference: string): Promise<TransferOutcome> {
    try {
      const { status, body } = await this.get(`/transfer/verify/${encodeURIComponent(reference)}`);
      if (status === 404) return { kind: "not_found" };
      return transferOutcome(status, body);
    } catch (err) {
      return { kind: "unknown", detail: (err as Error).message };
    }
  }

  parseTransferEvent(rawBody: string): TransferEvent | null {
    try {
      const b = JSON.parse(rawBody) as { event?: string; data?: { reference?: unknown } };
      const reference = typeof b.data?.reference === "string" ? b.data.reference : null;
      if (!reference) return null;
      if (b.event === "transfer.success") return { reference, status: "succeeded" };
      if (b.event === "transfer.failed") return { reference, status: "failed" };
      if (b.event === "transfer.reversed") return { reference, status: "reversed" };
      return null;
    } catch {
      return null;
    }
  }

  async createDedicatedAccount(c: { email: string; firstName: string; lastName: string; phone: string }): Promise<DedicatedAccount> {
    const customer = await this.post("/customer", { email: c.email, first_name: c.firstName, last_name: c.lastName, phone: c.phone });
    const customerCode = String(customer.customer_code ?? "");
    if (!customerCode) throw new PaystackError("paystack: no customer code");
    const acct = await this.post("/dedicated_account", { customer: customerCode, preferred_bank: this.c.preferredBank });
    const bank = acct.bank as { name?: string } | undefined;
    const accountNumber = String(acct.account_number ?? "");
    if (!accountNumber) throw new PaystackError("paystack: no account number yet");
    return { customerCode, accountNumber, bankName: bank?.name ?? "", accountName: String(acct.account_name ?? "") };
  }

  verifySignature(rawBody: string, headers: Record<string, string | string[] | undefined>): boolean {
    const sig = headers["x-paystack-signature"];
    if (typeof sig !== "string" || !/^[0-9a-f]{128}$/i.test(sig)) return false;
    const expected = createHmac("sha512", this.c.secretKey).update(rawBody).digest();
    return timingSafeEqual(expected, Buffer.from(sig, "hex"));
  }

  // ── Checkout (D-075) ──

  async start(c: { email: string; reference: string; totalMinor: bigint; callbackUrl: string; metadata: Record<string, string> }): Promise<CheckoutStart> {
    const d = await this.post("/transaction/initialize", {
      email: c.email,
      amount: c.totalMinor.toString(),
      currency: "NGN",
      reference: c.reference,
      callback_url: c.callbackUrl,
      channels: ["card", "bank", "ussd", "qr", "bank_transfer"],
      metadata: c.metadata,
    });
    const url = String(d.authorization_url ?? "");
    if (!url.startsWith("https://")) throw new PaystackError("paystack: no authorization url");
    return { authorizationUrl: url };
  }

  async verify(reference: string): Promise<CheckoutResult> {
    const r = await this.get(`/transaction/verify/${encodeURIComponent(reference)}`);
    if (r.status === 404) return { reference, status: "pending", eventId: null, amountMinor: null, currency: null, channel: null, feesMinor: null };
    if (r.status >= 400 || !r.body.data) throw new PaystackError(`paystack: verify ${r.status} ${r.body.message ?? ""}`);
    return checkoutResult(reference, r.body.data as Record<string, unknown>);
  }

  parseCheckout(rawBody: string): CheckoutResult | null {
    let b: { event?: string; data?: Record<string, unknown> };
    try {
      b = JSON.parse(rawBody);
    } catch {
      return null;
    }
    const d = b.data;
    if (b.event !== "charge.success" || !d || d.channel === "dedicated_nuban" || typeof d.reference !== "string") return null;
    return checkoutResult(d.reference, d);
  }

  parseCredit(rawBody: string): FundingCredit | null {
    let b: { event?: string; data?: Record<string, unknown> };
    try {
      b = JSON.parse(rawBody);
    } catch {
      return null;
    }
    const d = b.data;
    if (b.event !== "charge.success" || !d || d.channel !== "dedicated_nuban" || d.status !== "success") return null;
    const customer = d.customer as { customer_code?: string } | undefined;
    // Paystack amounts are already in kobo, as integers.
    const amount = typeof d.amount === "number" && Number.isSafeInteger(d.amount) ? BigInt(d.amount) : typeof d.amount === "string" && /^\d+$/.test(d.amount) ? BigInt(d.amount) : null;
    if (!customer?.customer_code || amount === null || d.id == null) return null;
    return {
      eventId: String(d.id),
      customerCode: customer.customer_code,
      amountMinor: amount,
      currency: String(d.currency ?? "NGN"),
      reference: String(d.reference ?? ""),
    };
  }
}

function kobo(v: unknown): bigint | null {
  if (typeof v === "number" && Number.isSafeInteger(v) && v >= 0) return BigInt(v);
  if (typeof v === "string" && /^\d+$/.test(v)) return BigInt(v);
  return null;
}

/** Maps a Paystack transaction (webhook data or verify data). Only "success" credits; "failed" and "abandoned" end it. */
export function checkoutResult(reference: string, d: Record<string, unknown>): CheckoutResult {
  const s = String(d.status ?? "");
  const status = s === "success" ? "success" : s === "failed" || s === "abandoned" || s === "reversed" ? "failed" : "pending";
  return {
    reference,
    status,
    eventId: d.id == null ? null : String(d.id),
    amountMinor: kobo(d.amount),
    currency: typeof d.currency === "string" ? d.currency : null,
    channel: typeof d.channel === "string" ? d.channel : null,
    feesMinor: kobo(d.fees),
  };
}

/** Maps a Paystack transfer or verify response. Only an explicit failure is "failed"; anything unclear is "unknown". */
export function transferOutcome(status: number, body: unknown): TransferOutcome {
  const b = (body ?? {}) as { status?: boolean; message?: string; data?: { status?: string; transfer_code?: string } };
  const st = b.data?.status;
  const code = b.data?.transfer_code ?? null;
  if (status >= 500) return { kind: "unknown", detail: `http ${status}` };
  if (b.status && st === "success") return { kind: "succeeded", transferCode: code };
  if (b.status && (st === "pending" || st === "processing" || st === "received" || st === "queued")) return { kind: "sent", transferCode: code };
  if (b.status && st === "otp") return { kind: "needs_otp" };
  if (st === "failed" || st === "reversed" || st === "abandoned" || st === "rejected") return { kind: "failed", detail: st };
  if (status === 400 && /duplicate/i.test(b.message ?? "")) return { kind: "sent", transferCode: null }; // same reference already accepted
  if (status === 400 || status === 422) return { kind: "failed", detail: b.message ?? `http ${status}` };
  return { kind: "unknown", detail: b.message ?? `http ${status}` };
}

/** For tests and local dev: signs with a known secret, hands out predictable account numbers. */
export class FakeFunding implements Funding, Payouts, Checkout {
  readonly name = "fake";
  private n = 0;
  constructor(readonly secret = "fake-secret") {}

  async createDedicatedAccount(c: { email: string; firstName: string; lastName: string }): Promise<DedicatedAccount> {
    this.n += 1;
    return { customerCode: `CUS_fake${this.n}_${c.email}`, accountNumber: String(9_900_000_000 + this.n), bankName: "Test Bank", accountName: `CONSTANT/${c.firstName} ${c.lastName}`.toUpperCase() };
  }

  sign(rawBody: string): string {
    return createHmac("sha512", this.secret).update(rawBody).digest("hex");
  }

  verifySignature(rawBody: string, headers: Record<string, string | string[] | undefined>): boolean {
    return headers["x-paystack-signature"] === this.sign(rawBody);
  }

  parseCredit(rawBody: string): FundingCredit | null {
    return new Paystack({ secretKey: this.secret, preferredBank: "test-bank" }).parseCredit(rawBody);
  }

  // ── Checkout ──
  checkouts = new Map<string, { totalMinor: bigint; email: string; result: CheckoutResult | null }>();
  startFails = false;
  async start(c: { email: string; reference: string; totalMinor: bigint }): Promise<CheckoutStart> {
    if (this.startFails) throw new Error("fake: checkout unavailable");
    this.checkouts.set(c.reference, { totalMinor: c.totalMinor, email: c.email, result: null });
    return { authorizationUrl: `https://checkout.example/${c.reference}` };
  }
  /** Test helper: what verify() will say for this reference. */
  settle(reference: string, r: Partial<CheckoutResult> & { status: CheckoutResult["status"] }) {
    const c = this.checkouts.get(reference);
    if (!c) throw new Error(`fake: no checkout ${reference}`);
    c.result = { reference, eventId: `T${reference}`, amountMinor: c.totalMinor, currency: "NGN", channel: "card", feesMinor: null, ...r };
  }
  async verify(reference: string): Promise<CheckoutResult> {
    return this.checkouts.get(reference)?.result ?? { reference, status: "pending", eventId: null, amountMinor: null, currency: null, channel: null, feesMinor: null };
  }
  parseCheckout(rawBody: string): CheckoutResult | null {
    return new Paystack({ secretKey: this.secret, preferredBank: "test-bank" }).parseCheckout(rawBody);
  }

  // ── Payouts ──
  accounts = new Map<string, string>([["058:0123456789", "OBI ADA CHIOMA"]]);
  transfers = new Map<string, { amountMinor: bigint; recipient: string; state: "sent" | "succeeded" | "failed" }>();
  transferScript: (TransferOutcome | "throw")[] = [];
  async banks(): Promise<Bank[]> {
    return [
      { code: "058", name: "Guaranty Trust Bank" },
      { code: "044", name: "Access Bank" },
    ];
  }
  async resolveAccount(bankCode: string, accountNumber: string) {
    return this.accounts.get(`${bankCode}:${accountNumber}`) ?? null;
  }
  async createRecipient(r: { bankCode: string; accountNumber: string }) {
    return `RCP_${r.bankCode}_${r.accountNumber}`;
  }
  async transfer(t: { reference: string; recipientCode: string; amountMinor: bigint }): Promise<TransferOutcome> {
    const next = this.transferScript.shift();
    if (next === "throw") {
      this.transfers.set(t.reference, { amountMinor: t.amountMinor, recipient: t.recipientCode, state: "sent" });
      throw new Error("connection reset");
    }
    if (this.transfers.has(t.reference)) return { kind: "sent", transferCode: null }; // idempotent by reference
    const out = next ?? { kind: "sent" as const, transferCode: `TRF_${this.transfers.size + 1}` };
    if (out.kind === "sent" || out.kind === "succeeded") this.transfers.set(t.reference, { amountMinor: t.amountMinor, recipient: t.recipientCode, state: out.kind });
    return out;
  }
  async verifyTransfer(reference: string): Promise<TransferOutcome> {
    const t = this.transfers.get(reference);
    if (!t) return { kind: "not_found" };
    return t.state === "failed" ? { kind: "failed", detail: "failed" } : t.state === "succeeded" ? { kind: "succeeded", transferCode: null } : { kind: "sent", transferCode: null };
  }
  parseTransferEvent(rawBody: string): TransferEvent | null {
    return new Paystack({ secretKey: this.secret, preferredBank: "test-bank" }).parseTransferEvent(rawBody);
  }
}
