import { describe, expect, it } from "vitest";
import { naira, render, type NoticeKind } from "../src/index.js";

const KINDS: NoticeKind[] = ["renewed", "renewal_failed", "insufficient", "above_cap", "funded", "needs_attention"];

describe("copy", () => {
  it("formats naira from kobo", () => {
    expect(naira(1_995_000n)).toBe("₦19,950");
    expect(naira(50n)).toBe("₦0.50");
  });
  it.each(KINDS)("%s fits one SMS and names no chain or full number", (kind) => {
    const m = render(kind, { line: "Living room DSTV", amountMinor: "1995000", capMinor: "2500000", shortMinor: "500000", dueAt: "2026-11-15T06:00:00Z", balanceMinor: "100" });
    expect(m.text.length).toBeLessThanOrEqual(160);
    expect(m.text).not.toMatch(/usdc|crypto|wallet|blockchain|\b\d{10,}\b/i);
  });
});

describe("stablecoin copy (D-053)", () => {
  it("names the token and network, fits one SMS", () => {
    const m = render("stables_arrived", { amount: "20.00", symbol: "USDC", network: "Base" });
    expect(m.text).toContain("20.00 USDC arrived on Base");
    expect(m.text.length).toBeLessThanOrEqual(160);
    expect(render("token_quarantined", { network: "Arc" }).text.length).toBeLessThanOrEqual(160);
  });
});
