import { describe, expect, it } from "vitest";
import { naira, render, type NoticeKind } from "../src/index.js";

const KINDS: NoticeKind[] = ["renewed", "renewal_failed", "insufficient", "above_cap", "funded", "needs_attention", "withdrawal_sent", "withdrawal_failed", "topped_up", "bill_paid", "weekly_cap"];

describe("copy", () => {
  it("formats naira from kobo", () => {
    expect(naira(1_995_000n)).toBe("₦19,950");
    expect(naira(50n)).toBe("₦0.50");
  });
  it.each(KINDS)("%s fits one SMS and names no chain or full number", (kind) => {
    const m = render(kind, { line: "Living room DSTV", amountMinor: "1995000", capMinor: "2500000", shortMinor: "500000", dueAt: "2026-11-15T06:00:00Z", balanceMinor: "100", setAsideMinor: "2500000" });
    expect(m.text.length).toBeLessThanOrEqual(160);
    expect(m.text).not.toMatch(/usdc|crypto|wallet|blockchain|\b\d{10,}\b/i);
  });
});

describe("electricity token (D-079)", () => {
  it("carries the token to its owner and fits one SMS", () => {
    const m = render("token", { line: "Home meter", amountMinor: "500000", token: "1234-5678-9012-3456-7890", units: "45.2" });
    expect(m.text).toContain("1234-5678-9012-3456-7890");
    expect(m.text).toContain("45.2 kWh");
    expect(m.text.length).toBeLessThanOrEqual(160);
  });
});

describe("stablecoin copy (D-053)", () => {
  it("names the token and network, fits one SMS", () => {
    const m = render("stables_arrived", { amount: "20.00", symbol: "USDC", network: "Base" });
    expect(m.text).toContain("20.00 USDC arrived on Base");
    expect(m.text.length).toBeLessThanOrEqual(160);
    expect(render("token_quarantined", { network: "Arc" }).text.length).toBeLessThanOrEqual(160);
    for (const k of ["stables_short", "allowance_low", "permission_needed", "permission_on", "permission_failed"] as const) {
      expect(render(k, { line: "Living room DSTV", usd: "14.76", have: "10.00" }).text.length).toBeLessThanOrEqual(160);
    }
  });
});

describe("reminders while a bill waits (D-091)", () => {
  const base = { line: "Living room DSTV", amountMinor: "1995000", shortMinor: "500000", dueAt: "2026-11-12T17:00:00Z" };
  it.each(["bill_due_soon", "bill_last_call"] as const)("%s says when it ends and the one step that fixes it, in one SMS", (kind) => {
    for (const held of ["insufficient", "above_cap", "weekly_cap"]) {
      const m = render(kind, { ...base, held });
      expect(m.text.length).toBeLessThanOrEqual(160);
      expect(m.text).toContain("Thu 12 Nov, 6 pm");
      expect(m.text).toMatch(held === "insufficient" ? /Add ₦5,000/ : /raise it in the app/);
    }
  });
});
