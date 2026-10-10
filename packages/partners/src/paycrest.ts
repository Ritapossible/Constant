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
