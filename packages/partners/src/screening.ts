/**
 * Circle Compliance Engine address screening (developers.circle.com, openapi/compliance.yaml, checked 2026-10-10):
 * POST /v1/w3s/compliance/screening/addresses {idempotencyKey, address, chain} with a Bearer API key →
 * {result: "APPROVED" | "DENIED", decision: {...}}.
 * Circle's published chain list has no Base or Arc yet. EVM addresses are identical across chains and sanctions
 * lists name addresses, so EVM addresses are screened as "ETH" by default (CIRCLE_SCREENING_CHAIN to change).
 */
import { randomUUID } from "node:crypto";
import { fetchJson, type Fetch } from "./http.js";
import type { AddressScreener, ScreeningResult } from "./types.js";

export class CircleScreener implements AddressScreener {
  private readonly f: Fetch;
  constructor(
    private readonly apiKey: string,
    private readonly chain = "ETH",
    private readonly baseUrl = "https://api.circle.com",
    f?: Fetch,
  ) {
    this.f = f ?? fetch;
  }

  async screen(address: string): Promise<ScreeningResult> {
    const res = await fetchJson(this.f, `${this.baseUrl}/v1/w3s/compliance/screening/addresses`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ idempotencyKey: randomUUID(), address, chain: this.chain }),
      timeoutMs: 15_000,
    });
    const b = (res.body as { data?: Record<string, unknown> } & Record<string, unknown>) ?? {};
    const data = (b.data ?? b) as { result?: string; decision?: { ruleName?: string; reasons?: { riskScore?: string; riskCategories?: string[] }[] } };
    if (res.status !== 200 || (data.result !== "APPROVED" && data.result !== "DENIED")) throw new Error(`screening unavailable (${res.status})`);
    if (data.result === "APPROVED") return { result: "clear" };
    const r = data.decision?.reasons?.[0];
    return { result: "flagged", detail: [data.decision?.ruleName, r?.riskScore, r?.riskCategories?.join("/")].filter(Boolean).join(" · ") || "denied" };
  }
}

/** Tests and local dev: addresses ending in 9999 are flagged, like Circle's sandbox. */
export class FakeScreener implements AddressScreener {
  calls: string[] = [];
  fail = false;
  async screen(address: string): Promise<ScreeningResult> {
    this.calls.push(address);
    if (this.fail) throw new Error("screening down");
    return /9999$/i.test(address) ? { result: "flagged", detail: "SANCTIONS · BLOCKLIST" } : { result: "clear" };
  }
}
