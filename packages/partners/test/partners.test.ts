import { createHmac, generateKeyPairSync } from "node:crypto";
import { SignJWT, importPKCS8 } from "jose";
import { describe, expect, it } from "vitest";
import { HttpMessaging, FakeMessaging, Telegram, parseTelegramUpdate, withTelegram, cleanToken, vtpassToken, Paystack, Privy, Vtpass, contactFromPrivyUser, nairaToMinor, parseDueDate, vtpassOutcome, type Fetch } from "../src/index.js";

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

  it("airtime goes to the number on the right network (9mobile is etisalat at VTpass)", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const v = new Vtpass({ ...cfg, fetch: stubFetch([{ body: { code: "000", content: { transactions: { status: "delivered", transactionId: 1 } } } }], seen) });
    const out = await v.vend({ requestId: "r1", kind: "airtime", provider: "9mobile", ref: "08091234567", amountMinor: 100_000n, phone: "08000000000" });
    expect(out.kind).toBe("delivered");
    expect(JSON.parse(seen[0]!.init.body as string)).toEqual({ request_id: "r1", serviceID: "etisalat", amount: "1000.00", phone: "08091234567" });
  });

  it("data buys the chosen bundle for the number", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const v = new Vtpass({ ...cfg, fetch: stubFetch([{ body: { code: "000", content: { transactions: { status: "delivered" } } } }], seen) });
    await v.vend({ requestId: "r2", kind: "data", provider: "mtn", ref: "08031234567", amountMinor: 100_000n, phone: "08000000000", variationCode: "mtn-10mb-100" });
    expect(JSON.parse(seen[0]!.init.body as string)).toMatchObject({ serviceID: "mtn-data", billersCode: "08031234567", variation_code: "mtn-10mb-100", amount: "1000.00" });
    await expect(v.vend({ requestId: "r3", kind: "data", provider: "mtn", ref: "08031234567", amountMinor: 1n, phone: "0" })).rejects.toThrow("bundle");
  });

  it("electricity returns the token from the pay reply and from a requery", async () => {
    const delivered = { code: "000", content: { transactions: { status: "delivered", transactionId: "77" } } };
    const v = new Vtpass({ ...cfg, fetch: stubFetch([{ body: { ...delivered, purchased_code: "Token : 1234 5678 9012 3456 7890", units: "45.2 kWh" } }, { body: { ...delivered, mainToken: "12345678901234567890", mainTokenUnits: 45.2 } }]) });
    const paid = await v.vend({ requestId: "r4", kind: "electricity", provider: "ikedc", ref: "45012345678", amountMinor: 500_000n, phone: "08000000000", meterType: "prepaid" });
    expect(paid).toEqual({ kind: "delivered", partnerTxnId: "77", token: "1234-5678-9012-3456-7890", units: "45.2" });
    expect(await v.requery("r4")).toEqual({ kind: "delivered", partnerTxnId: "77", token: "1234-5678-9012-3456-7890", units: "45.2" });
  });

  it("meter lookup sends the meter type and reads the name; a wrong meter is not_found", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const v = new Vtpass({ ...cfg, fetch: stubFetch([{ body: { code: "000", content: { Customer_Name: "ADA OBI", Address: "12 Allen Ave" } } }, { body: { code: "000", content: { WrongBillersCode: true } } }], seen) });
    expect(await v.lookupMeter("ekedc", "45012345678", "postpaid")).toEqual({ ok: true, customerName: "ADA OBI", address: "12 Allen Ave", meterType: "postpaid" });
    expect(JSON.parse(seen[0]!.init.body as string)).toEqual({ billersCode: "45012345678", serviceID: "eko-electric", type: "postpaid" });
    expect(await v.lookupMeter("ekedc", "1", "prepaid")).toEqual({ ok: false, reason: "not_found" });
  });

  it("data plans come with today's prices", async () => {
    const v = new Vtpass({ ...cfg, fetch: stubFetch([{ body: { content: { variations: [{ variation_code: "mtn-1gb", name: "MTN 1GB ", variation_amount: "1000.00" }, { variation_code: "x", name: "free", variation_amount: "0" }] } } }]) });
    expect(await v.dataPlans("mtn")).toEqual([{ code: "mtn-1gb", name: "MTN 1GB", amountMinor: 100_000n }]);
  });

  it("tokens are only accepted when they look like tokens", () => {
    expect(cleanToken("Token : 1234-5678-9012-3456-7890")).toBe("1234-5678-9012-3456-7890");
    expect(cleanToken("12")).toBeNull();
    expect(cleanToken(undefined)).toBeNull();
    expect(vtpassToken({})).toEqual({ token: null, units: null });
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
    expect(p.parseCredit(body)).toEqual({ eventId: "302961", customerCode: "CUS_1", amountMinor: 500_000n, currency: "NGN", reference: "ref1", senderName: null });
  });

  it("ignores card payments and other events", () => {
    expect(p.parseCredit(body.replace("dedicated_nuban", "card"))).toBeNull();
    expect(p.parseCredit(JSON.stringify({ event: "transfer.success", data: {} }))).toBeNull();
  });

  it("parses a checkout payment (card, USSD, QR) by our reference, and leaves dedicated-account credits alone", () => {
    const card = body.replace("dedicated_nuban", "card").replace('"reference":"ref1"', '"reference":"cu_top_1","fees":1523');
    expect(p.parseCheckout(card)).toEqual({ reference: "cu_top_1", status: "success", eventId: "302961", amountMinor: 500_000n, currency: "NGN", channel: "card", feesMinor: 1523n });
    expect(p.parseCheckout(body)).toBeNull();
    expect(p.parseCheckout(JSON.stringify({ event: "charge.failed", data: { reference: "x" } }))).toBeNull();
    expect(p.parseCheckout("not json")).toBeNull();
  });

  it("starts a checkout with our reference and every local channel, and verifies it", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const ps = new Paystack({
      secretKey: "sk_test_abc",
      preferredBank: "test-bank",
      fetch: stubFetch(
        [
          { body: { status: true, data: { authorization_url: "https://checkout.paystack.com/abc", access_code: "abc", reference: "cu_top_1" } } },
          { body: { status: true, data: { id: 9, status: "abandoned", amount: 101523, currency: "NGN", channel: "card" } } },
          { status: 404, body: { status: false, message: "Transaction reference not found" } },
        ],
        seen,
      ),
    });
    const s = await ps.start({ email: "a@b.co", reference: "cu_top_1", totalMinor: 101_523n, callbackUrl: "https://x/app", metadata: { topupId: "1" } });
    expect(s.authorizationUrl).toBe("https://checkout.paystack.com/abc");
    const sent = JSON.parse(String(seen[0]!.init.body));
    expect(sent).toMatchObject({ amount: "101523", currency: "NGN", reference: "cu_top_1", channels: ["card", "bank", "ussd", "qr", "bank_transfer"] });
    expect((await ps.verify("cu_top_1")).status).toBe("failed");
    expect((await ps.verify("cu_top_2")).status).toBe("pending");
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
    expect(await privy.verify(await sign("app1"))).toEqual({ did: "did:privy:abc", sid: "s" });
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
    const r = await new PaycrestRates("https://api.paycrest.io", stubFetch([{ body: { status: "success", message: "ok", data: "1352.34" } }], seen)).toNgn("USDC", 14.7);
    expect(r.ngnPerUsdc).toBe("1352.34");
    expect(seen[0]!.url).toBe("https://api.paycrest.io/v1/rates/USDC/15/NGN?network=base");
    await new PaycrestRates("https://api.paycrest.io", stubFetch([{ body: { status: "success", data: "1350.00" } }], seen)).toNgn("USDT", 20);
    expect(seen[1]!.url).toBe("https://api.paycrest.io/v1/rates/USDT/20/NGN?network=base");
    await expect(new PaycrestRates("https://x", stubFetch([])).toNgn("DAI" as never, 1)).rejects.toThrow("unsupported");
  });
  it("refuses anything that isn't a plain rate", async () => {
    const { PaycrestRates } = await import("../src/index.js");
    await expect(new PaycrestRates("https://x", stubFetch([{ body: { status: "success", data: "-1" } }])).toNgn("USDC", 1)).rejects.toThrow();
    await expect(new PaycrestRates("https://x", stubFetch([{ status: 500, body: {} }])).toNgn("USDC", 1)).rejects.toThrow();
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

describe("Paystack transfers (D-067)", () => {
  it("maps transfer responses; only explicit failures fail", async () => {
    const { transferOutcome } = await import("../src/index.js");
    expect(transferOutcome(200, { status: true, data: { status: "pending", transfer_code: "TRF_1" } })).toEqual({ kind: "sent", transferCode: "TRF_1" });
    expect(transferOutcome(200, { status: true, data: { status: "success" } }).kind).toBe("succeeded");
    expect(transferOutcome(200, { status: true, data: { status: "otp" } }).kind).toBe("needs_otp");
    expect(transferOutcome(200, { status: true, data: { status: "failed" } }).kind).toBe("failed");
    expect(transferOutcome(400, { status: false, message: "Duplicate Transfer Reference" }).kind).toBe("sent");
    expect(transferOutcome(400, { status: false, message: "Insufficient balance" }).kind).toBe("failed");
    expect(transferOutcome(502, {}).kind).toBe("unknown");
  });
  it("reads transfer webhooks", () => {
    const p = new Paystack({ secretKey: "sk", preferredBank: "test-bank" });
    expect(p.parseTransferEvent(JSON.stringify({ event: "transfer.success", data: { reference: "cw_1" } }))).toEqual({ reference: "cw_1", status: "succeeded" });
    expect(p.parseTransferEvent(JSON.stringify({ event: "transfer.reversed", data: { reference: "cw_1" } }))?.status).toBe("reversed");
    expect(p.parseTransferEvent(JSON.stringify({ event: "charge.success", data: { reference: "x" } }))).toBeNull();
  });
  it("resolves account names", async () => {
    const p = new Paystack({ secretKey: "sk", preferredBank: "test-bank", fetch: stubFetch([{ body: { status: true, data: { account_name: "OBI ADA" } } }, { status: 422, body: { status: false } }]) });
    expect(await p.resolveAccount("058", "0123456789")).toBe("OBI ADA");
    expect(await p.resolveAccount("058", "0000000000")).toBeNull();
  });
});

describe("Paycrest off-ramp (D-068)", () => {
  it("creates an order and sends amount plus fees; maps statuses", async () => {
    const { PaycrestSender, offrampStatus } = await import("../src/index.js");
    const seen: { url: string; init: RequestInit }[] = [];
    const p = new PaycrestSender("KEY", "SECRET", "https://api.paycrest.io", stubFetch([{ status: 201, body: { status: "success", data: { id: "o1", amount: "100", receiveAddress: "0xabc", senderFee: "0.5", transactionFee: "0.25", validUntil: "2026-11-14T09:00:00Z" } } }], seen));
    const o = await p.createOrder({ token: "USDC", amountMicro: 100_000_000n, rate: "1352.34", reference: "ofr_1", returnAddress: "0xspender", recipient: { institution: "GTBINGLA", accountIdentifier: "0123456789", accountName: "VTPASS", memo: "float" } });
    expect(o.sendMicro).toBe(100_750_000n);
    const h = seen[0]!.init.headers as Record<string, string>;
    expect(h["API-Key"]).toBe("KEY");
    expect(JSON.parse(seen[0]!.init.body as string)).toMatchObject({ amount: 100, token: "USDC", network: "base", rate: 1352.34, reference: "ofr_1" });
    expect(["validated", "settled", "refunded", "expired", "pending", "deposited"].map(offrampStatus)).toEqual(["settled", "settled", "refunded", "expired", "pending", "pending"]);
  });
  it("verifies webhook signatures on the raw body, as hex strings", async () => {
    const { PaycrestSender } = await import("../src/index.js");
    const p = new PaycrestSender("KEY", "SECRET");
    const body = JSON.stringify({ event: "payment_order.settled", data: { id: "o1", reference: "ofr_1", status: "settled" } });
    const sig = createHmac("sha256", "SECRET").update(body).digest("hex");
    expect(p.verifyWebhook(body, sig.toUpperCase())).toBe(true);
    expect(p.verifyWebhook(body + " ", sig)).toBe(false);
    expect(p.parseWebhook(body)).toEqual({ orderId: "o1", reference: "ofr_1", status: "settled" });
  });
});

describe("email (Resend)", () => {
  it("sends from EMAIL_FROM with replies to EMAIL_REPLY_TO", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const m = new HttpMessaging({ resend: { apiKey: "re_test", from: "ConstantUnits <hello@example.com>", replyTo: "help@example.com" }, fetch: stubFetch([{ body: { id: "em_1" } }], seen) });
    expect(m.channels).toEqual(["email"]);
    expect(await m.send("email", "ada@example.com", "Renewed", "Done")).toEqual({ providerId: "em_1" });
    expect(seen[0]!.url).toBe("https://api.resend.com/emails");
    expect(JSON.parse(seen[0]!.init.body as string)).toEqual({ from: "ConstantUnits <hello@example.com>", to: ["ada@example.com"], subject: "Renewed", text: "Done", reply_to: "help@example.com" });
  });

  it("leaves reply_to out when it isn't set, and fails loudly on an error", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const m = new HttpMessaging({ resend: { apiKey: "re_test", from: "a@example.com" }, fetch: stubFetch([{ body: { id: "em_2" } }, { status: 422, body: { message: "domain not verified" } }], seen) });
    await m.send("email", "b@example.com", "s", "t");
    expect(JSON.parse(seen[0]!.init.body as string)).not.toHaveProperty("reply_to");
    await expect(m.send("email", "b@example.com", "s", "t")).rejects.toThrow("email failed (422)");
  });
});

describe("Telegram (D-082)", () => {
  it("sends to the chat, and an error never repeats the bot token", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const tg = new Telegram({ botToken: "123:SECRETPART", fetch: stubFetch([{ body: { ok: true, result: { message_id: 42 } } }, { status: 403, body: { ok: false, description: "Forbidden: bot was blocked by the user" } }], seen) });
    expect(await tg.sendMessage("555", "hello")).toEqual({ messageId: "42" });
    expect(seen[0]!.url).toBe("https://api.telegram.org/bot123:SECRETPART/sendMessage");
    expect(JSON.parse(seen[0]!.init.body as string)).toMatchObject({ chat_id: "555", text: "hello" });
    const err = await tg.sendMessage("555", "x").catch((e: Error) => e.message);
    expect(err).toContain("blocked by the user");
    expect(err).not.toContain("SECRETPART");
  });

  it("reads private text messages only", () => {
    expect(parseTelegramUpdate(JSON.stringify({ message: { chat: { id: 555, type: "private" }, text: " STOP " } }))).toEqual({ chatId: "555", text: "STOP" });
    expect(parseTelegramUpdate(JSON.stringify({ message: { chat: { id: -1, type: "group" }, text: "STOP" } }))).toBeNull();
    expect(parseTelegramUpdate(JSON.stringify({ edited_message: {} }))).toBeNull();
    expect(parseTelegramUpdate("nope")).toBeNull();
  });

  it("adds Telegram next to email and SMS", async () => {
    const base = new FakeMessaging();
    const m = withTelegram(base, new Telegram({ botToken: "t", fetch: stubFetch([{ body: { ok: true, result: { message_id: 7 } } }]) }));
    expect(m.channels).toEqual(["email", "sms", "telegram"]);
    expect(await m.send("telegram", "555", "s", "t")).toEqual({ providerId: "7" });
    await m.send("email", "a@example.com", "s", "t");
    expect(base.sent).toHaveLength(1);
  });
});
