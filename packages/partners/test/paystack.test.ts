import { describe, expect, it } from "vitest";
import { Paystack } from "../src/index.js";

describe("customer identification webhooks (D-086)", () => {
  const p = new Paystack({ secretKey: "sk_test", preferredBank: "wema-bank" });
  it("reads success and failure, with the reason", () => {
    expect(p.parseIdentification(JSON.stringify({ event: "customeridentification.success", data: { customer_code: "CUS_1", identification: { type: "bank_account" } } }))).toEqual({ customerCode: "CUS_1", verified: true, reason: null });
    expect(p.parseIdentification(JSON.stringify({ event: "customeridentification.failed", data: { customer_code: "CUS_1", reason: "Account number or BVN is incorrect" } }))).toEqual({ customerCode: "CUS_1", verified: false, reason: "Account number or BVN is incorrect" });
  });
  it("ignores other events and malformed bodies", () => {
    expect(p.parseIdentification(JSON.stringify({ event: "charge.success", data: { customer_code: "CUS_1" } }))).toBeNull();
    expect(p.parseIdentification("not json")).toBeNull();
    expect(p.parseIdentification(JSON.stringify({ event: "customeridentification.success", data: {} }))).toBeNull();
  });
});
