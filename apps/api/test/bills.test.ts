/**
 * API for every bill on the server (D-079) and sign-in sessions (D-080).
 */
import { Secrets, freshDatabase, testKeyB64, type Db } from "@constant/db";
import { FakeCableVending, FakeFunding, FakeIdentity } from "@constant/partners";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp, deviceName, nigerianMobile } from "../src/index.js";

let db: Db;
let drop: () => Promise<void>;
let app: FastifyInstance;
const identity = new FakeIdentity();
const funding = new FakeFunding("whsec");
const vending = new FakeCableVending();
const secrets = new Secrets({ encryption: [{ id: "k1", key: Buffer.from(testKeyB64(), "base64") }], hmac: Buffer.from(testKeyB64(), "base64") });
// 10:00 Lagos on 10 November.
const START = new Date("2026-11-10T09:00:00Z");
let clock = START;
const DAY = 86_400_000;

beforeAll(async () => {
  ({ db, drop } = await freshDatabase());
  vending.meters.set("45012345678", { customerName: "ADA OBI", address: "12 Allen Ave, Ikeja" });
  app = await buildApp({
    db,
    identity,
    vending,
    funding,
    secrets,
    webOrigins: ["https://constant-units.vercel.app"],
    vtpassWebhookToken: "vt-0123456789abcdef",
    fundingEmailDomain: "users.example",
    now: () => clock,
    logger: false,
  });
});
afterAll(async () => {
  await app?.close();
  await drop?.();
});

type Method = "GET" | "POST" | "PATCH" | "DELETE";
const call = (method: Method, url: string, who: string, body?: unknown) =>
  app.inject({ method, url, headers: { authorization: `Bearer fake:${who}`, "content-type": "application/json", "user-agent": "Mozilla/5.0 (Linux; Android 14) Chrome/130.0" }, ...(body !== undefined ? { payload: JSON.stringify(body) } : {}) });

describe("airtime and data", () => {
  it("a monthly airtime bill is saved with its number encrypted and its next day computed", async () => {
    const r = await call("POST", "/v1/lines", "did:privy:a1", { kind: "airtime", provider: "mtn", ref: "+234 803 123 4567", amountMinor: "100000", renewDay: 5, nickname: "My airtime" });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ kind: "airtime", provider: "mtn", last4: "4567", schedule: "monthly", renewDay: 5, amountMinor: "100000", capMinor: "100000", nextRunAt: "2026-12-05T06:00:00.000Z" });
    const row = (await db.query("SELECT ref_ciphertext FROM lines WHERE id = $1", [r.json().id])).rows[0];
    expect(row.ref_ciphertext).not.toContain("0803");
    expect(secrets.decrypt(row.ref_ciphertext)).toBe("08031234567");
  });

  it("refuses a bad number and anything under ₦500", async () => {
    expect((await call("POST", "/v1/lines", "did:privy:a1", { kind: "airtime", provider: "mtn", ref: "12345", amountMinor: "100000", renewDay: 5 })).json().error).toBe("invalid_phone");
    expect((await call("POST", "/v1/lines", "did:privy:a1", { kind: "airtime", provider: "mtn", ref: "08031234500", amountMinor: "49900", renewDay: 5 })).json().error).toBe("too_small");
  });

  it("the same number can have data and airtime, but not two of the same", async () => {
    expect((await call("POST", "/v1/lines", "did:privy:a1", { kind: "data", provider: "mtn", ref: "08031234567", variationCode: "mtn-1gb", renewDay: 5 })).statusCode).toBe(201);
    expect((await call("POST", "/v1/lines", "did:privy:a1", { kind: "airtime", provider: "mtn", ref: "08031234567", amountMinor: "100000", renewDay: 9 })).statusCode).toBe(409);
  });

  it("data takes the bundle's price from the partner, not from the app", async () => {
    const r = await call("POST", "/v1/lines", "did:privy:a2", { kind: "data", provider: "mtn", ref: "08031234567", variationCode: "mtn-2gb", amountMinor: "1", renewDay: 1 });
    expect(r.json()).toMatchObject({ amountMinor: "200000", planName: "MTN 2GB - 30 days", variationCode: "mtn-2gb" });
    expect((await call("POST", "/v1/lines", "did:privy:a2", { kind: "data", provider: "mtn", ref: "08031234568", renewDay: 1 })).json().error).toBe("bundle_needed");
    expect((await call("POST", "/v1/lines", "did:privy:a2", { kind: "data", provider: "mtn", ref: "08031234568", variationCode: "nope", renewDay: 1 })).json().error).toBe("bundle_gone");
  });

  it("lists bundles for a network", async () => {
    const r = await call("GET", "/v1/data-plans?network=mtn", "did:privy:a2");
    expect(r.json()[0]).toEqual({ code: "mtn-1gb", name: "MTN 1GB - 30 days", amountMinor: "100000" });
    expect((await call("GET", "/v1/data-plans?network=nope", "did:privy:a2")).statusCode).toBe(400);
  });

  it("a data bill moved from the phone without a bundle waits for one, then picking it turns it on", async () => {
    const r = await call("POST", "/v1/lines", "did:privy:a3", {
      kind: "data", provider: "airtel", ref: "08021234567", amountMinor: "150000", schedule: "usage", threshold: 300, import: true,
      readings: [{ at: "2026-11-01T09:00:00Z", value: 900 }, { at: "2026-11-08T09:00:00Z", value: 400 }, { at: "2099-01-01T00:00:00Z", value: 5 }],
    });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ setupNeeded: "bundle", schedule: "usage", threshold: 300, nextRunAt: null });
    expect(r.json().readings.map((x: { value: number }) => x.value)).toEqual([400, 900]); // newest first; a future one is dropped
    const p = await call("PATCH", `/v1/lines/${r.json().id}`, "did:privy:a3", { variationCode: "airtel-1gb" });
    expect(p.json()).toMatchObject({ setupNeeded: null, amountMinor: "100000", variationCode: "airtel-1gb" });
  });
});

describe("electricity", () => {
  it("looks a meter up", async () => {
    const r = await call("POST", "/v1/meters/lookup", "did:privy:e1", { provider: "ikedc", meter: "450 1234 5678", meterType: "prepaid" });
    expect(r.json()).toEqual({ customerName: "ADA OBI", address: "12 Allen Ave, Ikeja", meterType: "prepaid" });
    expect((await call("POST", "/v1/meters/lookup", "did:privy:e1", { provider: "ikedc", meter: "45000000000", meterType: "prepaid" })).json().error).toBe("not_found");
    expect((await call("POST", "/v1/meters/lookup", "did:privy:e1", { provider: "ibedc", meter: "45012345678", meterType: "prepaid" })).json().error).toBe("provider_off");
  });

  it("saves a checked meter with the name on it; postpaid can't be a top-up bill", async () => {
    const r = await call("POST", "/v1/lines", "did:privy:e1", { kind: "electricity", provider: "ikedc", ref: "45012345678", meterType: "prepaid", amountMinor: "500000", schedule: "usage", threshold: 20, weeklyCapMinor: "1500000" });
    expect(r.json()).toMatchObject({ customerName: "ADA OBI", meterType: "prepaid", schedule: "usage", weeklyCapMinor: "1500000" });
    const post = await call("POST", "/v1/lines", "did:privy:e1", { kind: "electricity", provider: "ikedc", ref: "45012345678", meterType: "postpaid", amountMinor: "500000", schedule: "usage", threshold: 20 });
    expect(post.statusCode).toBe(400);
    expect((await call("POST", "/v1/lines", "did:privy:e1", { kind: "electricity", provider: "ikedc", ref: "45012345678", meterType: "postpaid", amountMinor: "50000", renewDay: 3 })).json().error).toBe("too_small");
  });

  it("a reading at or below the level makes it due; a higher one cancels that; 'top up now' too", async () => {
    const id = (await call("GET", "/v1/lines", "did:privy:e1")).json()[0].id;
    expect((await call("POST", `/v1/lines/${id}/readings`, "did:privy:e1", { value: 50 })).json().nextRunAt).toBeNull();
    expect((await call("POST", `/v1/lines/${id}/readings`, "did:privy:e1", { value: 18.5 })).json().nextRunAt).toBe(START.toISOString());
    const up = await call("POST", `/v1/lines/${id}/readings`, "did:privy:e1", { value: 120 });
    expect(up.json().nextRunAt).toBeNull();
    expect(up.json().readings[0]).toEqual({ at: START.toISOString(), value: 120 });
    expect((await call("POST", `/v1/lines/${id}/top-up-now`, "did:privy:e1")).json().nextRunAt).toBe(START.toISOString());
  });

  it("the owner sees their token in the app; nobody else does", async () => {
    const line = (await call("GET", "/v1/lines", "did:privy:e1")).json()[0];
    const user = (await db.query("SELECT user_id FROM lines WHERE id = $1", [line.id])).rows[0].user_id;
    await db.query(
      `INSERT INTO orders (user_id, line_id, trigger, state, amount_minor, fee_minor, currency, idempotency_key, partner, receipt_id, token_ciphertext, token_units)
       VALUES ($1, $2, 'usage', 'settled', 500000, 10000, 'NGN', 'k-token', 'fake', 'r-token', $3, '45.2')`,
      [user, line.id, secrets.encrypt("1234-5678-9012-3456-7890")],
    );
    const mine = (await call("GET", "/v1/me", "did:privy:e1")).json().orders[0];
    expect(mine).toMatchObject({ token: "1234-5678-9012-3456-7890", tokenUnits: "45.2" });
    expect((await call("GET", "/v1/me", "did:privy:other")).json().orders).toEqual([]);
    expect((await call("PATCH", `/v1/lines/${line.id}`, "did:privy:other", { nickname: "x" })).statusCode).toBe(404);
    expect((await call("POST", `/v1/lines/${line.id}/readings`, "did:privy:other", { value: 1 })).statusCode).toBe(404);
  });
});

describe("changing a bill", () => {
  it("moving the day or resuming after a pause runs on the next day, never on a missed one", async () => {
    const id = (await call("POST", "/v1/lines", "did:privy:c1", { kind: "airtime", provider: "glo", ref: "08051234567", amountMinor: "100000", renewDay: 20 })).json().id;
    expect((await call("PATCH", `/v1/lines/${id}`, "did:privy:c1", { renewDay: 12 })).json().nextRunAt).toBe("2026-11-12T06:00:00.000Z");
    await call("PATCH", `/v1/lines/${id}`, "did:privy:c1", { status: "paused" });
    clock = new Date("2026-11-25T09:00:00Z"); // two weeks later: signed in again (a new session)
    expect((await call("PATCH", `/v1/lines/${id}`, "did:privy:c1#later", { status: "active" })).json().nextRunAt).toBe("2026-12-12T06:00:00.000Z");
    clock = START;
  });

  it("a limit can't be lower than one payment", async () => {
    const id = (await call("POST", "/v1/lines", "did:privy:c2", { kind: "airtime", provider: "glo", ref: "08051234560", amountMinor: "100000", renewDay: 2 })).json().id;
    expect((await call("PATCH", `/v1/lines/${id}`, "did:privy:c2", { capMinor: "50000" })).statusCode).toBe(400);
    expect((await call("PATCH", `/v1/lines/${id}`, "did:privy:c2", { amountMinor: "200000" })).json()).toMatchObject({ amountMinor: "200000", capMinor: "200000" });
  });

  it("subscriptions are saved, in dollars, and never scheduled to pay", async () => {
    const r = await call("POST", "/v1/lines", "did:privy:c3", { kind: "subscription", provider: "chatgpt", ref: "Ada@Example.com", amountMinor: "2000", renewDay: 14 });
    expect(r.json()).toMatchObject({ currency: "USD", schedule: "none", last4: "ad•••@example.com", nextRunAt: null });
  });
});

describe("profile", () => {
  it("message channels are saved in order", async () => {
    expect((await call("PATCH", "/v1/me", "did:privy:p1", { channels: ["telegram", "email"] })).json()).toEqual({ channels: ["telegram", "email"] });
    expect((await call("GET", "/v1/me", "did:privy:p1")).json().user.channels).toEqual(["telegram", "email"]);
    expect((await call("PATCH", "/v1/me", "did:privy:p1", { channels: ["pigeon"] })).statusCode).toBe(400);
    expect((await call("PATCH", "/v1/me", "did:privy:p1", { channels: ["sms", "sms"] })).statusCode).toBe(400);
  });
});

describe("sessions (D-080)", () => {
  it("a session unused for more than 7 days is signed out; signing in again starts a new one", async () => {
    clock = START;
    expect((await call("GET", "/v1/me", "did:privy:s1#phone")).statusCode).toBe(200);
    clock = new Date(START.getTime() + 6 * DAY);
    expect((await call("GET", "/v1/me", "did:privy:s1#phone")).statusCode).toBe(200);
    clock = new Date(START.getTime() + 14 * DAY);
    const r = await call("GET", "/v1/me", "did:privy:s1#phone");
    expect(r.statusCode).toBe(401);
    expect(r.json().error).toBe("session_expired");
    clock = new Date(START.getTime() + 15 * DAY); // still out, even used again straight away
    expect((await call("GET", "/v1/me", "did:privy:s1#phone")).statusCode).toBe(401);
    expect((await call("GET", "/v1/me", "did:privy:s1#phone-2")).statusCode).toBe(200);
    clock = START;
  });

  it("no session lasts more than 30 days, however often it is used", async () => {
    for (let day = 0; day <= 30; day += 5) {
      clock = new Date(START.getTime() + day * DAY);
      expect((await call("GET", "/v1/me", "did:privy:s2#laptop")).statusCode).toBe(200);
    }
    clock = new Date(START.getTime() + 31 * DAY);
    expect((await call("GET", "/v1/me", "did:privy:s2#laptop")).statusCode).toBe(401);
    clock = START;
  });

  it("signing out ends the session for good; 'sign out everywhere' ends them all", async () => {
    expect((await call("GET", "/v1/me", "did:privy:s3#a")).statusCode).toBe(200);
    expect((await call("GET", "/v1/me", "did:privy:s3#b")).statusCode).toBe(200);
    const list = (await call("GET", "/v1/sessions", "did:privy:s3#a")).json();
    expect(list).toHaveLength(2);
    expect(list.find((x: { current: boolean }) => x.current).device).toBe("Android · Chrome");
    expect((await call("POST", "/v1/session/end", "did:privy:s3#a")).statusCode).toBe(204);
    expect((await call("GET", "/v1/me", "did:privy:s3#a")).statusCode).toBe(401);
    expect((await call("POST", "/v1/sessions/end-all", "did:privy:s3#b")).json()).toEqual({ ended: 1 });
    expect((await call("GET", "/v1/me", "did:privy:s3#b")).statusCode).toBe(401);
  });

  it("a session id can't be borrowed by another account", async () => {
    expect((await call("GET", "/v1/me", "did:privy:s4#shared")).statusCode).toBe(200);
    expect((await call("GET", "/v1/me", "did:privy:s5#shared")).statusCode).toBe(401);
  });
});

describe("closing an account (D-081)", () => {
  const who = "did:privy:closer";
  const transfer = (customerCode: string, id: number, amount: number) => {
    const body = JSON.stringify({ event: "charge.success", data: { id, status: "success", channel: "dedicated_nuban", amount, currency: "NGN", reference: `r${id}`, customer: { customer_code: customerCode } } });
    return app.inject({ method: "POST", url: "/webhooks/paystack", headers: { "content-type": "application/json", "x-paystack-signature": funding.sign(body) }, payload: body });
  };

  it("needs the word DELETE, and is refused while money is left or a payment is moving", async () => {
    clock = START;
    await call("PATCH", "/v1/me", who, { displayName: "Ada", channels: ["sms"] });
    await call("POST", "/v1/funding-account", who, { firstName: "Ada", lastName: "Obi", phone: "08031234567" });
    const line = (await call("POST", "/v1/lines", who, { kind: "electricity", provider: "ikedc", ref: "45012345678", meterType: "prepaid", amountMinor: "500000", renewDay: 3 })).json();
    await call("POST", `/v1/lines/${line.id}/readings`, who, { value: 3 });

    expect((await call("DELETE", "/v1/me", who, {})).json().error).toBe("confirm");

    const { user_id, customer_code } = (await db.query("SELECT f.user_id, f.customer_code FROM funding_accounts f JOIN users u ON u.id = f.user_id WHERE u.privy_did = $1", [who])).rows[0];
    expect((await transfer(customer_code, 9001, 200_000)).json().result).toBe("credited");
    const refused = await call("DELETE", "/v1/me", who, { confirm: "DELETE" });
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({ error: "balance_remaining" });
    expect(refused.json().message).toContain("₦2,000");

    // The money is returned to the person (by a person, for now), then a payment in progress still blocks closing.
    await db.query("INSERT INTO ledger_entries (user_id, kind, amount_minor, currency, idempotency_key, actor) VALUES ($1, 'adjust', -200000, 'NGN', 'test:returned', 'ops')", [user_id]);
    await db.query(
      `INSERT INTO orders (user_id, line_id, trigger, state, amount_minor, fee_minor, currency, idempotency_key, partner, receipt_id)
       VALUES ($1, $2, 'scheduled', 'vending', 500000, 0, 'NGN', 'k-closing', 'fake', 'r-closing')`,
      [user_id, line.id],
    );
    expect((await call("DELETE", "/v1/me", who, { confirm: "DELETE" })).json().error).toBe("in_flight");
    await db.query("UPDATE orders SET state = 'failed' WHERE idempotency_key = 'k-closing'");
  });

  it("erases the person, their payees, readings, account number and sign-in; keeps the money record without them", async () => {
    const { id } = (await db.query("SELECT id FROM users WHERE privy_did = $1", [who])).rows[0];
    const ledgerBefore = (await db.query("SELECT count(*)::int AS n FROM ledger_entries WHERE user_id = $1", [id])).rows[0].n;

    // A fresh session: the earlier tries used up this minute's limit of three on the other one.
    expect((await call("DELETE", "/v1/me", `${who}#closing`, { confirm: "DELETE" })).statusCode).toBe(204);

    const u = (await db.query("SELECT * FROM users WHERE id = $1", [id])).rows[0];
    expect(u).toMatchObject({ status: "closed", email: null, phone_e164: null, display_name: null, channels: [] });
    expect(u.privy_did).toBe(`closed:${id}`);
    const lines = (await db.query("SELECT * FROM lines WHERE user_id = $1", [id])).rows;
    expect(lines.every((l) => l.status === "cancelled" && l.ref_ciphertext === "erased" && l.customer_name === null && l.ref_last4 === "")).toBe(true);
    expect((await db.query("SELECT count(*)::int AS n FROM line_readings WHERE line_id = ANY($1::uuid[])", [lines.map((l) => l.id)])).rows[0].n).toBe(0);
    expect((await db.query("SELECT count(*)::int AS n FROM funding_accounts WHERE user_id = $1", [id])).rows[0].n).toBe(0);
    expect((await db.query("SELECT count(*)::int AS n FROM sessions WHERE user_id = $1 AND revoked_at IS NULL", [id])).rows[0].n).toBe(0);
    expect((await db.query("SELECT count(*)::int AS n FROM ledger_entries WHERE user_id = $1", [id])).rows[0].n).toBe(ledgerBefore);
    expect(identity.deleted).toContain(who);
    expect((await db.query("SELECT 1 FROM ops_alerts WHERE kind = 'account_closed_deactivate_number'")).rowCount).toBe(1);
  });

  it("a transfer to the old account number is held for a person, never credited to the closed account", async () => {
    const { detail } = (await db.query("SELECT detail FROM ops_alerts WHERE kind = 'account_closed_deactivate_number'")).rows[0];
    expect((await transfer(detail.customerCode, 9002, 100_000)).json().result).toBe("rejected");
    const { id } = (await db.query("SELECT id FROM users WHERE privy_did LIKE 'closed:%' LIMIT 1")).rows[0];
    expect((await db.query("SELECT COALESCE(SUM(amount_minor), 0)::bigint AS s FROM ledger_entries WHERE user_id = $1", [id])).rows[0].s).toBe(0n);
  });

  it("signing in again starts a new, empty account", async () => {
    const me = (await call("GET", "/v1/me", `${who}#new-session`)).json();
    expect(me.lines).toEqual([]);
    expect(me.user.displayName).toBeNull();
  });
});

describe("helpers", () => {
  it("normalises Nigerian numbers", () => {
    expect(nigerianMobile("+234 803 123 4567")).toBe("08031234567");
    expect(nigerianMobile("2348031234567")).toBe("08031234567");
    expect(nigerianMobile("0803-123-4567")).toBe("08031234567");
    expect(nigerianMobile("0603 123 4567")).toBeNull();
  });

  it("names devices", () => {
    expect(deviceName("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit Version/17.0 Mobile Safari/604.1")).toBe("iPhone · Safari");
    expect(deviceName(null)).toBe("Unknown device");
  });
});
