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

describe("transfer sender (D-088)", () => {
  const p = new Paystack({ secretKey: "sk_test", preferredBank: "wema-bank" });
  const credit = (authorization?: unknown) =>
    p.parseCredit(JSON.stringify({ event: "charge.success", data: { id: 1, status: "success", channel: "dedicated_nuban", amount: 5000, currency: "NGN", reference: "r", customer: { customer_code: "CUS_1" }, ...(authorization ? { authorization } : {}) } }));
  it("reads the sender's name when the bank sent it", () => {
    expect(credit({ sender_name: " RANDALL AKANBI HORTON ", sender_bank: "FCMB" })?.senderName).toBe("RANDALL AKANBI HORTON");
    expect(credit()?.senderName).toBeNull();
    expect(credit({ sender_name: "" })?.senderName).toBeNull();
  });
});
