/**
 * INV-14: no full smartcard, meter, phone or token number reaches the logs. The logger is the last line of defence:
 * whatever a caller passes, a run of 10 or more digits is cut to its last 4, and fields named like secrets are hidden.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { jsonLog, redact } from "../src/log.js";

const printed = () => {
  const spies = (["log", "warn", "error"] as const).map((k) => vi.spyOn(console, k).mockImplementation(() => undefined));
  return () => spies.flatMap((s) => s.mock.calls.map((c) => String(c[0])));
};
afterEach(() => vi.restoreAllMocks());

describe("logs never hold a full number (INV-14)", () => {
  it("cuts any run of 10+ digits to its last 4, in the message and in every field", () => {
    const lines = printed();
    const log = jsonLog("worker");
    log.info("vend for smartcard 7012345678 failed", { ref: "meter 45012349999", note: "call +2348031234567" });
    log.warn("token 12345678901234567890 sent", { orderId: "a1b2" });
    log.error("requery 9876543210123", { amount: 1_995_000n });
    const out = lines().join("\n");
    for (const full of ["7012345678", "45012349999", "2348031234567", "12345678901234567890", "9876543210123"]) expect(out).not.toContain(full);
    expect(out).toContain("…5678");
    expect(out).toContain("…9999");
    expect(out).toContain("…4567");
    expect(out).toContain('"amount":"1995000"'); // short numbers and amounts stay readable
  });

  it("hides fields named like secrets, whatever their value", () => {
    const lines = printed();
    jsonLog("worker").info("sent", { token: "1234-5678", smartcardRef: "abc", phone: "0803", apiKey: "not-a-real-key", partnerRef: "vt-123" });
    const row = JSON.parse(lines()[0]!);
    expect(row).toMatchObject({ token: "[redacted]", smartcardRef: "[redacted]", phone: "[redacted]", apiKey: "[redacted]", partnerRef: "vt-123" });
  });

  it("leaves short numbers alone", () => {
    expect(redact("order 123456789 for ₦19,950")).toBe("order 123456789 for ₦19,950");
    expect(redact("1234567890")).toBe("…7890");
  });
});
