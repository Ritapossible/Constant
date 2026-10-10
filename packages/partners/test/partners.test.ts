import { createHmac, generateKeyPairSync } from "node:crypto";
import { SignJWT, importPKCS8 } from "jose";
import { describe, expect, it } from "vitest";
import { Paystack, Privy, Vtpass, contactFromPrivyUser, nairaToMinor, parseDueDate, vtpassOutcome, type Fetch } from "../src/index.js";

function stubFetch(responses: { status?: number; body: unknown }[], seen: { url: string; init: RequestInit }[] = []): Fetch {
  return (async (url: string, init: RequestInit) => {
    seen.push({ url, init });
    const r = responses.shift() ?? { status: 500, body: {} };
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
  }) as unknown as Fetch;
}

describe("money parsing", () => {
  it.each([
    ["19,950.00", 1_995_000n],
    ["19950", 1_995_000n],
    [19950.5, 1_995_050n],
    ["₦4,400", 440_000n],
    ["abc", null],
    [-1, null],
  ])("%s → %s", (v, out) => expect(nairaToMinor(v)).toBe(out));
});

describe("VTpass outcomes (INV-13: only 'delivered' settles)", () => {
  it.each([
    [{ code: "000", content: { transactions: { status: "delivered", transactionId: "177" } } }, "delivered"],
    [{ code: "000", content: { transactions: { status: "pending" } } }, "pending"],
    [{ code: "000", content: { transactions: { status: "initiated" } } }, "pending"],
    [{ code: "099" }, "pending"],
    [{ code: "016" }, "failed"],
    [{ code: "018" }, "failed"],
    [{ code: "040" }, "reversed"],
    [{ code: "015" }, "not_found"],
    [{ code: "014" }, "unknown"],
    [{ code: "083" }, "unknown"],
    [{ code: "777" }, "unknown"],
    [{}, "unknown"],
  ])("%j → %s", (body, kind) => expect(vtpassOutcome(200, body).kind).toBe(kind));

  it("a 5xx is never a failure, only unknown", () => expect(vtpassOutcome(502, { code: "016" }).kind).toBe("unknown"));
});

describe("VTpass adapter", () => {
  const cfg = { baseUrl: "https://sandbox.vtpass.com/api", apiKey: "ak", publicKey: "PK_x", secretKey: "SK_x" };

  it("request ids start with Lagos YYYYMMDDHHII and are 12+ chars", () => {
    const v = new Vtpass(cfg);
    const id = v.newRequestId("0b6f2b8e-4c1a-4bde-9a0e-0d5c7f3e8a11", new Date("2026-11-13T23:30:00Z"));
    expect(id.startsWith("202611140030")).toBe(true);
    expect(id.length).toBeGreaterThanOrEqual(12);
  });

  it("renew posts the secret-key headers, renew type and naira amount", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const v = new Vtpass({ ...cfg, fetch: stubFetch([{ body: { code: "000", content: { transactions: { status: "delivered", transactionId: 9 } } } }], seen) });
    const out = await v.renew({ requestId: "202611140700abc", provider: "dstv", smartcard: "7012345678", amountMinor: 1_995_000n, phone: "08000000000" });
    expect(out).toEqual({ kind: "delivered", partnerTxnId: "9" });
    expect(seen[0]!.url).toBe("https://sandbox.vtpass.com/api/pay");
    const h = seen[0]!.init.headers as Record<string, string>;
    expect(h["secret-key"]).toBe("SK_x");
    expect(JSON.parse(seen[0]!.init.body as string)).toMatchObject({ amount: "19950.00", subscription_type: "renew", serviceID: "dstv" });
  });

  it("a network error on renew is unknown, never failed", async () => {
    const v = new Vtpass({ ...cfg, fetch: (async () => { throw new Error("ECONNRESET"); }) as unknown as Fetch });
    expect((await v.renew({ requestId: "x", provider: "gotv", smartcard: "1", amountMinor: 1n, phone: "0" })).kind).toBe("unknown");
  });

  it("lookup reads name, bouquet, renewal amount and due date", async () => {
    const v = new Vtpass({ ...cfg, fetch: stubFetch([{ body: { code: "000", content: { Customer_Name: "ADA OBI", Current_Bouquet: "DStv Compact", Renewal_Amount: 19950, Due_Date: "2026-11-15T00:00:00" } } }]) });
    const r = await v.lookup("dstv", "7012345678");
    expect(r).toEqual({ ok: true, customerName: "ADA OBI", currentPlan: "DStv Compact", renewalAmountMinor: 1_995_000n, dueAt: new Date("2026-11-14T23:00:00Z") });
  });

  it("lookup of an unknown decoder is not_found", async () => {
    const v = new Vtpass({ ...cfg, fetch: stubFetch([{ body: { code: "000", content: { error: "This IUC is invalid" } } }]) });
    expect(await v.lookup("dstv", "1")).toEqual({ ok: false, reason: "not_found" });
  });

  it("webhook gives only a request id to requery", () => {
    const v = new Vtpass(cfg);
    expect(v.webhookRequestId(JSON.stringify({ type: "transaction-update", data: { requestId: "abc", code: "000" } }))).toBe("abc");
    expect(v.webhookRequestId("nope")).toBeNull();
  });

  it("due dates in either format", () => {
    expect(parseDueDate("2026-11-15")?.toISOString()).toBe("2026-11-14T23:00:00.000Z");
    expect(parseDueDate("15 Nov 2026")?.toISOString()).toBe("2026-11-14T23:00:00.000Z");
    expect(parseDueDate("")).toBeNull();
  });
});

describe("Paystack", () => {
  const p = new Paystack({ secretKey: "sk_test_abc", preferredBank: "test-bank" });
  const body = JSON.stringify({
    event: "charge.success",
    data: { id: 302961, status: "success", channel: "dedicated_nuban", amount: 500000, currency: "NGN", reference: "ref1", customer: { customer_code: "CUS_1" } },
  });
  const sig = createHmac("sha512", "sk_test_abc").update(body).digest("hex");

  it("accepts only a correct signature on the raw bytes", () => {
    expect(p.verifySignature(body, { "x-paystack-signature": sig })).toBe(true);
    expect(p.verifySignature(body + " ", { "x-paystack-signature": sig })).toBe(false);
    expect(p.verifySignature(body, {})).toBe(false);
    expect(p.verifySignature(body, { "x-paystack-signature": "00" })).toBe(false);
  });

  it("parses a transfer into a dedicated account, in kobo", () => {
    expect(p.parseCredit(body)).toEqual({ eventId: "302961", customerCode: "CUS_1", amountMinor: 500_000n, currency: "NGN", reference: "ref1" });
  });

  it("ignores card payments and other events", () => {
    expect(p.parseCredit(body.replace("dedicated_nuban", "card"))).toBeNull();
    expect(p.parseCredit(JSON.stringify({ event: "transfer.success", data: {} }))).toBeNull();
  });

  it("creates a customer then a dedicated account", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const ps = new Paystack({
      secretKey: "sk_test_abc",
      preferredBank: "test-bank",
      fetch: stubFetch(
        [
          { body: { status: true, data: { customer_code: "CUS_9" } } },
          { body: { status: true, data: { account_number: "9930000001", account_name: "CONSTANT/ADA OBI", bank: { name: "Test Bank" } } } },
        ],
        seen,
      ),
    });
    expect(await ps.createDedicatedAccount({ email: "a@b.c", firstName: "Ada", lastName: "Obi", phone: "+2348000000000" })).toEqual({
      customerCode: "CUS_9", accountNumber: "9930000001", bankName: "Test Bank", accountName: "CONSTANT/ADA OBI",
    });
    expect(JSON.parse(seen[1]!.init.body as string)).toEqual({ customer: "CUS_9", preferred_bank: "test-bank" });
  });
});

describe("Privy", () => {
  it("verifies issuer, audience and signature", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const pem = publicKey.export({ type: "spki", format: "pem" }).toString();
    const key = await importPKCS8(privateKey.export({ type: "pkcs8", format: "pem" }).toString(), "ES256");
    const sign = (aud: string, iss = "privy.io") =>
      new SignJWT({ sid: "s" }).setProtectedHeader({ alg: "ES256" }).setSubject("did:privy:abc").setIssuer(iss).setAudience(aud).setIssuedAt().setExpirationTime("1h").sign(key);
    const privy = new Privy({ appId: "app1", appSecret: "x", verificationKey: pem });
    expect(await privy.verify(await sign("app1"))).toBe("did:privy:abc");
    expect(await privy.verify(await sign("other-app"))).toBeNull();
    expect(await privy.verify(await sign("app1", "evil.io"))).toBeNull();
    expect(await privy.verify("garbage")).toBeNull();
  });

  it("reads verified contact details", () => {
    expect(
      contactFromPrivyUser("did:privy:a", {
        linked_accounts: [
          { type: "google_oauth", email: "ada@gmail.com" },
          { type: "phone", phoneNumber: "+234 800 000 0000" },
          { type: "wallet", chain_type: "ethereum", address: "0x1111111111111111111111111111111111111111", wallet_client_type: "privy", connector_type: "embedded" },
          { type: "wallet", chain_type: "ethereum", address: "0x2222222222222222222222222222222222222222", wallet_client_type: "metamask", connector_type: "injected" },
          { type: "wallet", chain_type: "solana", address: "So1ana" },
          { type: "smart_wallet", address: "0x3333333333333333333333333333333333333333", smart_wallet_type: "coinbase_smart_wallet" },
        ],
      }),
    ).toEqual({
      did: "did:privy:a",
      email: "ada@gmail.com",
      phoneE164: "+2348000000000",
      wallets: [
        { address: "0x1111111111111111111111111111111111111111", kind: "embedded" },
        { address: "0x2222222222222222222222222222222222222222", kind: "external" },
        { address: "0x3333333333333333333333333333333333333333", kind: "smart" },
      ],
    });
  });
});

describe("Paycrest rates", () => {
  it("reads naira per USDC on Base", async () => {
    const { PaycrestRates } = await import("../src/index.js");
    const seen: { url: string; init: RequestInit }[] = [];
    const r = await new PaycrestRates("https://api.paycrest.io", stubFetch([{ body: { status: "success", message: "ok", data: "1352.34" } }], seen)).usdcToNgn(14.7);
    expect(r.ngnPerUsdc).toBe("1352.34");
    expect(seen[0]!.url).toBe("https://api.paycrest.io/v1/rates/USDC/15/NGN?network=base");
  });
  it("refuses anything that isn't a plain rate", async () => {
    const { PaycrestRates } = await import("../src/index.js");
    await expect(new PaycrestRates("https://x", stubFetch([{ body: { status: "success", data: "-1" } }])).usdcToNgn(1)).rejects.toThrow();
    await expect(new PaycrestRates("https://x", stubFetch([{ status: 500, body: {} }])).usdcToNgn(1)).rejects.toThrow();
  });
});

describe("float and screening", () => {
  it("reads the VTpass float in kobo, rounded down", async () => {
    const v = new Vtpass({ baseUrl: "https://sandbox.vtpass.com/api", apiKey: "a", publicKey: "p", secretKey: "s", fetch: stubFetch([{ body: { code: 1, contents: { balance: 1081.8199999998 } } }]) });
    expect(await v.floatBalance()).toBe(108_182n);
    const bad = new Vtpass({ baseUrl: "x", apiKey: "a", publicKey: "p", secretKey: "s", fetch: stubFetch([{ body: { code: 0 } }]) });
    await expect(bad.floatBalance()).rejects.toThrow();
  });
  it("maps Circle's screening result; an outage is an error, never 'clear'", async () => {
    const { CircleScreener } = await import("../src/index.js");
    const seen: { url: string; init: RequestInit }[] = [];
    const ok = new CircleScreener("KEY", "ETH", "https://api.circle.com", stubFetch([{ body: { data: { result: "APPROVED" } } }], seen));
    expect(await ok.screen("0xabc")).toEqual({ result: "clear" });
    expect(seen[0]!.url).toBe("https://api.circle.com/v1/w3s/compliance/screening/addresses");
    expect(JSON.parse(seen[0]!.init.body as string)).toMatchObject({ address: "0xabc", chain: "ETH" });
    const denied = new CircleScreener("KEY", "ETH", "x", stubFetch([{ body: { data: { result: "DENIED", decision: { ruleName: "Sanctions", reasons: [{ riskScore: "BLOCKLIST", riskCategories: ["SANCTIONS"] }] } } } }]));
    expect(await denied.screen("0xdead9999")).toEqual({ result: "flagged", detail: "Sanctions · BLOCKLIST · SANCTIONS" });
    const down = new CircleScreener("KEY", "ETH", "x", stubFetch([{ status: 503, body: {} }]));
    await expect(down.screen("0x1")).rejects.toThrow();
  });
});
