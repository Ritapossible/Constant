import { describe, expect, it } from "vitest";
import { emailFor, isGsm7, naira, render, smsParts, toSmsText, type NoticeKind } from "../src/index.js";

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

  const params = { line: "Living room DSTV", provider: "dstv", last4: "4821", amountMinor: "1995000", capMinor: "2500000", shortMinor: "500000", dueAt: "2026-11-15T17:30:00Z", balanceMinor: "100", setAsideMinor: "2500000", token: "1234-5678-9012-3456-7890", units: "45.2", bank: "GTBank", held: "insufficient", likelyAt: "2026-11-15T17:30:00Z", paidWith: "14.75 USDC on Stellar", preview: "1", reason: "The BVN and account number didn't match.", renewsAt: "2026-11-09T06:00:00Z", priceMinor: "2000", currency: "USD" };
  it.each([...KINDS, "token", "bill_due_soon", "bill_last_call", "kyc_verified", "kyc_failed", "running_low", "welcome", "subscription_soon", "subscription_tomorrow"] as NoticeKind[])("%s goes by SMS as one GSM-7 message", (kind) => {
    const sms = toSmsText(render(kind, params).text);
    expect(isGsm7(sms)).toBe(true);
    expect(smsParts(sms)).toBe(1);
  });
});

describe("subscription renewals (D-096)", () => {
  const p = { line: "ChatGPT Plus", renewsAt: "2026-11-09T06:00:00Z", priceMinor: "2000", currency: "USD" };
  it("says when, the merchant's price, and that the card on that account is charged", () => {
    expect(render("subscription_soon", p)).toEqual({
      subject: "ChatGPT Plus renews on Mon, 9 Nov",
      text: "ConstantUnits: ChatGPT Plus renews on Mon, 9 Nov for $20, charged to the card on that account. To stop it, cancel before then.",
    });
    expect(render("subscription_tomorrow", { ...p, priceMinor: "1999" })).toEqual({
      subject: "ChatGPT Plus renews tomorrow",
      text: "ConstantUnits: ChatGPT Plus renews tomorrow for $19.99, charged to the card on that account. Check the card can pay, or cancel today.",
    });
  });

  it("never says ConstantUnits pays it, and still reads well without a price", () => {
    for (const kind of ["subscription_soon", "subscription_tomorrow"] as const) {
      const m = render(kind, { line: "A very long subscription name, Claude Max", renewsAt: p.renewsAt });
      expect(m.text).not.toMatch(/we'll pay|we pay|ConstantUnits pays/i);
      expect(m.text).not.toContain(" for ");
      expect(smsParts(toSmsText(m.text))).toBe(1);
    }
  });
});

describe("running low (D-092)", () => {
  it("says when, and the two things that help: top up now, or a fresh reading", () => {
    const m = render("running_low", { line: "My MTN data", likelyAt: "2026-11-12T17:30:00Z" });
    expect(m.subject).toBe("My MTN data is running low");
    expect(m.text).toBe("ConstantUnits: My MTN data will likely run low by Thu 12 Nov, 6:30 pm. Tap Top up now in the app, or add today's balance.");
  });
});

describe("emails (D-092)", () => {
  const ctx = { appUrl: "https://constantunits.xyz/", name: "Rita Egwuatu" };

  it("greets by first name, keeps the words, links to the app, and says how to change channels", () => {
    const m = render("running_low", { line: "My MTN data", likelyAt: "2026-11-12T17:30:00Z" });
    const e = emailFor("running_low", m, {}, ctx);
    expect(e.subject).toBe(m.subject);
    expect(e.text.startsWith("Hi Rita,\n\nMy MTN data will likely run low by Thu 12 Nov, 6:30 pm.")).toBe(true);
    expect(e.text).toContain("Open ConstantUnits: https://constantunits.xyz/app");
    expect(e.text).toContain("open the app, then Account");
    expect(e.html).toContain('href="https://constantunits.xyz/app"');
    expect(e.html).toContain("Hi Rita,");
    expect(e.html).not.toContain("ConstantUnits: My MTN"); // the SMS-style prefix is for SMS only
  });

  it("says Hello without a name, and puts an electricity token in its own box", () => {
    const p = { line: "Home meter", amountMinor: "500000", token: "1234-5678-9012-3456-7890", units: "45.2" };
    const e = emailFor("token", render("token", p), p, { appUrl: "https://constantunits.xyz" });
    expect(e.text.startsWith("Hello,")).toBe(true);
    expect(e.html.match(/1234-5678-9012-3456-7890/g)).toHaveLength(2); // in the sentence and in the box
    expect(e.html).toContain("₦5,000"); // email keeps the naira sign
  });

  it("escapes everything that came from a person, so a bill name can't inject HTML", () => {
    const p = { line: `<img src=x onerror="alert(1)">`, likelyAt: "2026-11-12T17:30:00Z" };
    const e = emailFor("running_low", render("running_low", p), p, { appUrl: "https://constantunits.xyz", name: "<b>Ada</b>" });
    expect(e.html).not.toContain("<img src=x");
    expect(e.html).not.toContain("<b>Ada");
    expect(e.html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  });

  it.each([...KINDS, "token", "bill_due_soon", "bill_last_call", "running_low", "kyc_verified"] as NoticeKind[])("%s has a complete email", (kind) => {
    const p = { line: "Living room DSTV", amountMinor: "1995000", capMinor: "2500000", shortMinor: "500000", dueAt: "2026-11-15T17:30:00Z", likelyAt: "2026-11-15T17:30:00Z", token: "1234-5678-9012-3456-7890", held: "insufficient" };
    const e = emailFor(kind, render(kind, p), p, ctx);
    expect(e.html.startsWith("<!doctype html>")).toBe(true);
    expect(e.html).toContain("Open ConstantUnits");
    expect(e.text.split("\n\n")).toHaveLength(4);
  });
});

describe("welcome and paid-with (D-093)", () => {
  it("welcomes without promising payments while they're switched off", () => {
    const preview = render("welcome", { preview: "1" });
    expect(preview.subject).toBe("Your ConstantUnits account is ready");
    expect(preview.text).toContain("Bill payments switch on soon");
    expect(preview.text.toLowerCase()).not.toContain("we'll pay");
    const live = render("welcome", {});
    expect(live.text).toContain("we'll pay it on the day you choose");
    for (const m of [preview, live]) expect(smsParts(toSmsText(m.text))).toBe(1);
  });

  it("the welcome email adds the three steps to start, in HTML and plain text", () => {
    const e = emailFor("welcome", render("welcome", { preview: "1" }), { preview: "1" }, { appUrl: "https://constantunits.xyz", name: "Ada Obi" });
    expect(e.text).toContain("1. Add a bill for yourself or someone else: data, airtime, light, TV or a subscription\n2. Set its limit");
    for (const said of ["subscriptions renew", "ChatGPT", "Claude", "a friend or family"]) expect(e.text).toContain(said); // never left out (CLAUDE.md)
    expect(e.html.match(/<li /g)).toHaveLength(3);
    expect(e.text.startsWith("Hi Ada,")).toBe(true);
    expect(e.html).toContain("Add your first bill");
    expect(e.text).toContain("Bill payments switch on soon");
    expect(e.text).not.toContain("is paid as soon");
    const live = emailFor("welcome", render("welcome", {}), {}, { appUrl: "https://constantunits.xyz/" });
    expect(live.text).not.toContain("switch on soon");
    expect(live.html).toContain('src="https://constantunits.xyz/email/mark.png"');
  });

  it("no message shouts: no exclamation marks anywhere, in any channel", () => {
    const p = { line: "Living room DSTV", amountMinor: "1995000", capMinor: "2500000", shortMinor: "500000", dueAt: "2026-11-15T17:30:00Z", likelyAt: "2026-11-15T17:30:00Z", token: "1234-5678-9012-3456-7890", held: "insufficient" };
    for (const kind of [...KINDS, "token", "bill_due_soon", "bill_last_call", "running_low", "kyc_verified", "kyc_failed", "welcome", "subscription_soon", "subscription_tomorrow"] as NoticeKind[]) {
      for (const q of [p, { ...p, preview: "1" }]) {
        const m = render(kind, q);
        const e = emailFor(kind, m, q, { appUrl: "https://constantunits.xyz" });
        expect(m.subject + m.text + e.text).not.toContain("!");
      }
    }
  });

  it("a bill paid from stablecoins says what left the person's account; one paid in naira doesn't", () => {
    const p = { line: "Living room DSTV", amountMinor: "1995000", dueAt: "2026-12-11T23:00:00Z" };
    expect(render("renewed", { ...p, paidWith: "14.75 USDC on Stellar" }).text).toBe(
      "ConstantUnits: Living room DSTV renewed for ₦19,950. Next renewal Sat, 12 Dec. Paid with 14.75 USDC on Stellar.",
    );
    expect(render("renewed", p).text).not.toContain("Paid with");
    for (const kind of ["topped_up", "bill_paid"] as const) expect(render(kind, { ...p, paidWith: "3.00 USDT on Base" }).text).toContain("Paid with 3.00 USDT on Base.");
  });
});
