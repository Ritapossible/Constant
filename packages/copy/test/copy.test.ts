import { describe, expect, it } from "vitest";
import { isGsm7, naira, render, smsParts, toSmsText, type NoticeKind } from "../src/index.js";

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

describe("SMS in the GSM-7 alphabet (INV-24)", () => {
  it("counts parts the way networks bill them", () => {
    expect(smsParts("a".repeat(160))).toBe(1);
    expect(smsParts("a".repeat(161))).toBe(2);
    expect(smsParts("€".repeat(80))).toBe(1); // extension characters count twice
    expect(smsParts("₦" + "a".repeat(69))).toBe(1);
    expect(smsParts("₦" + "a".repeat(70))).toBe(2); // one naira sign: 70 a part, not 160
  });

  it("the problem it fixes: a token message with ₦ costs two SMS; as GSM-7 it costs one", () => {
    const m = render("token", { line: "Home meter", amountMinor: "500000", token: "1234-5678-9012-3456-7890", units: "45.2" });
    expect(isGsm7(m.text)).toBe(false);
    expect(smsParts(m.text)).toBe(2);
    const sms = toSmsText(m.text);
    expect(isGsm7(sms)).toBe(true);
    expect(smsParts(sms)).toBe(1);
    expect(sms).toContain("N5,000 token");
    expect(sms).toContain("1234-5678-9012-3456-7890");
  });

  it("substitutes what our messages use, and keeps the GSM-7 extension characters", () => {
    expect(toSmsText("DStv ••4821 — ₦1,995.50 “paid” …")).toBe('DStv **4821 - N1,995.50 "paid" ...');
    expect(toSmsText("€ [x] {y} ~z")).toBe("€ [x] {y} ~z");
    expect(toSmsText("ok 👍")).toBe("ok ");
  });

  const params = { line: "Living room DSTV", provider: "dstv", last4: "4821", amountMinor: "1995000", capMinor: "2500000", shortMinor: "500000", dueAt: "2026-11-15T17:30:00Z", balanceMinor: "100", setAsideMinor: "2500000", token: "1234-5678-9012-3456-7890", units: "45.2", bank: "GTBank", held: "insufficient", reason: "The BVN and account number didn't match." };
  it.each([...KINDS, "token", "bill_due_soon", "bill_last_call", "kyc_verified", "kyc_failed"] as NoticeKind[])("%s goes by SMS as one GSM-7 message", (kind) => {
    const sms = toSmsText(render(kind, params).text);
    expect(isGsm7(sms)).toBe(true);
    expect(smsParts(sms)).toBe(1);
  });
});
