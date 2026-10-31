/**
 * Data, airtime and electricity on the server (D-079): monthly bills, top-ups when a line is reported low,
 * the weekly cap, data bundle prices, and electricity tokens (encrypted, sent only to the owner).
 */
import { Secrets, freeBalance, freshDatabase, insertLedger, insertLine, insertReading, ledgerSum, movePot, potBalance, withTx, setChannels, setVendingEnabled, testKeyB64, upsertUser, type Db, type NewLine } from "@constant/db";
import { FakeCableVending, FakeMessaging } from "@constant/partners";
import { isGsm7, smsParts } from "@constant/copy";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CHECK_BACKOFF_MIN, clearPlanCache, processOrders, remindRunningLow, scanRenewals, sendNotices, silentLog, type Deps } from "../src/index.js";

let db: Db;
let drop: () => Promise<void>;
const secrets = new Secrets({ encryption: [{ id: "k1", key: Buffer.from(testKeyB64(), "base64") }], hmac: Buffer.from(testKeyB64(), "base64") });

// 07:00 Lagos on 5 November.
const T0 = new Date("2026-11-05T06:00:00Z");
const MIN = 60_000;
const HOUR = 60 * MIN;

let clock: Date;
let vending: FakeCableVending;
let messaging: FakeMessaging;
let deps: Deps;
let n = 0;

beforeAll(async () => {
  ({ db, drop } = await freshDatabase());
});
afterAll(async () => drop?.());

beforeEach(async () => {
  clock = T0;
  vending = new FakeCableVending();
  messaging = new FakeMessaging();
  clearPlanCache();
  deps = { db, vending, messaging, secrets, log: silentLog, now: () => clock, fallbackPhone: "08000000000" };
  await db.query("UPDATE lines SET status = 'cancelled' WHERE status <> 'cancelled'");
  await db.query("UPDATE orders SET state = 'failed' WHERE state IN ('ready','vending','token_stored','notifying','needs_human')");
  await db.query("UPDATE notices SET status = 'failed' WHERE status = 'pending'");
  await setVendingEnabled(db, true, "test", "tests");
});

async function user(fundMinor = 5_000_000n) {
  n += 1;
  const u = await upsertUser(db, { privyDid: `did:privy:b${n}`, email: `b${n}@example.com` });
  if (fundMinor) await insertLedger(db, { userId: u.id, kind: "fund", amountMinor: fundMinor, currency: "NGN", idempotencyKey: `test:bfund:${n}`, actor: "test" });
  // Not the account's first payment, so the per-bill fee applies (the first is free: covered in the cable tests).
  await db.query(
    `INSERT INTO orders (user_id, line_id, trigger, state, amount_minor, fee_minor, currency, idempotency_key, partner, receipt_id)
     SELECT $1::uuid, l.id, 'renewal', 'settled', 1, 0, 'NGN', $2, 'fake', $3 FROM lines l LIMIT 1`,
    [u.id, `seed:${u.id}`, `seed-${u.id}`],
  );
  return u;
}

async function line(userId: string, l: Partial<NewLine> & Pick<NewLine, "kind" | "provider">, ref: string) {
  return insertLine(db, {
    userId,
    refCiphertext: secrets.encrypt(ref),
    refHmac: secrets.hmac(`${l.kind}:${l.provider}:${ref}`),
    refLast4: ref.slice(-4),
    customerName: null,
    planName: null,
    nickname: `My ${l.kind}`,
    currency: "NGN",
    capMinor: l.amountMinor ?? 100_000n,
    dueAt: null,
    nextRunAt: T0,
    ...l,
  });
}

const orders = async (lineId: string) => (await db.query("SELECT * FROM orders WHERE line_id = $1 ORDER BY created_at", [lineId])).rows;
const lineRow = async (id: string) => (await db.query("SELECT * FROM lines WHERE id = $1", [id])).rows[0];
const noticeRows = async (userId: string) => (await db.query("SELECT kind, params FROM notices WHERE user_id = $1 ORDER BY id", [userId])).rows;

// A cable line must exist for the seed orders above to reference.
beforeAll(async () => {
  const u = await upsertUser(db, { privyDid: "did:privy:seed", email: "seed@example.com" });
  await insertLine(db, {
    userId: u.id, kind: "tv", provider: "dstv", refCiphertext: secrets.encrypt("7000000000"), refHmac: secrets.hmac("dstv:7000000000"), refLast4: "0000",
    customerName: "SEED", planName: null, nickname: "seed", currency: "NGN", capMinor: 1n, dueAt: null, nextRunAt: null,
  });
});

describe("monthly airtime", () => {
  it("pays the set amount to the number on its day, with the airtime fee, and moves to the same day next month", async () => {
    const u = await user();
    const l = await line(u.id, { kind: "airtime", provider: "mtn", schedule: "monthly", renewDay: 5, amountMinor: 100_000n }, "08031234567");

    expect(await scanRenewals(deps)).toBe(1);
    await processOrders(deps);

    expect(vending.calls.vend).toHaveLength(1);
    expect(vending.calls.vend[0]).toMatchObject({ kind: "airtime", provider: "mtn", ref: "08031234567", amountMinor: 100_000n });
    expect(await ledgerSum(db, u.id)).toBe(5_000_000n - 100_000n - 3_000n); // ₦1,000 + the ₦30 airtime fee
    const [o] = await orders(l.id);
    expect(o.trigger).toBe("scheduled");
    expect((await lineRow(l.id)).next_run_at.toISOString()).toBe("2026-12-05T06:00:00.000Z");

    expect(await sendNotices(deps)).toBe(1);
    expect(messaging.sent[0]!.text).toContain("topped up with ₦1,000");
    expect(messaging.sent[0]!.text).not.toContain("08031234567");

    clock = new Date(T0.getTime() + 10 * MIN);
    expect(await scanRenewals(deps)).toBe(0);
  });
});

describe("data bundles", () => {
  it("buys the chosen bundle at today's price", async () => {
    const u = await user();
    const l = await line(u.id, { kind: "data", provider: "mtn", schedule: "monthly", renewDay: 5, amountMinor: 100_000n, variationCode: "mtn-1gb" }, "08031234567");
    vending.plansByNetwork.set("mtn", [{ code: "mtn-1gb", name: "MTN 1GB", amountMinor: 95_000n }]);
    expect(await scanRenewals(deps)).toBe(1);
    await processOrders(deps);
    expect(vending.calls.vend[0]).toMatchObject({ kind: "data", variationCode: "mtn-1gb", amountMinor: 95_000n });
    expect((await orders(l.id))[0].fee_minor).toBe(5_000n);
  });

  it("a bundle that now costs more than the limit is asked about, never bought", async () => {
    const u = await user();
    const l = await line(u.id, { kind: "data", provider: "mtn", schedule: "monthly", renewDay: 5, amountMinor: 100_000n, capMinor: 100_000n, variationCode: "mtn-1gb" }, "08031234568");
    vending.plansByNetwork.set("mtn", [{ code: "mtn-1gb", name: "MTN 1GB", amountMinor: 120_000n }]);
    expect(await scanRenewals(deps)).toBe(0);
    expect(vending.calls.vend).toHaveLength(0);
    expect((await noticeRows(u.id)).map((x) => x.kind)).toEqual(["above_cap"]);
    expect(await orders(l.id)).toHaveLength(0);
  });

  it("a bundle the network no longer sells: nothing is bought", async () => {
    const u = await user();
    await line(u.id, { kind: "data", provider: "mtn", schedule: "monthly", renewDay: 5, amountMinor: 100_000n, variationCode: "gone" }, "08031234569");
    expect(await scanRenewals(deps)).toBe(0);
    expect(vending.calls.vend).toHaveLength(0);
  });

  it("an imported data bill without a bundle waits for the user", async () => {
    const u = await user();
    await line(u.id, { kind: "data", provider: "mtn", schedule: "monthly", renewDay: 5, amountMinor: 100_000n, setupNeeded: "bundle" }, "08031234560");
    expect(await scanRenewals(deps)).toBe(0);
  });
});

describe("electricity", () => {
  it("prepaid: the token is stored encrypted, sent to the owner, and never kept in the message queue", async () => {
    const u = await user();
    const l = await line(u.id, { kind: "electricity", provider: "ikedc", schedule: "monthly", renewDay: 5, amountMinor: 500_000n, meterType: "prepaid" }, "45012345678");
    expect(await scanRenewals(deps)).toBe(1);
    await processOrders(deps);
    expect(vending.calls.vend[0]).toMatchObject({ kind: "electricity", meterType: "prepaid", ref: "45012345678" });

    const [o] = await orders(l.id);
    expect(o.token_ciphertext).toBeTruthy();
    expect(o.token_ciphertext).not.toContain("1234");
    expect(secrets.decrypt(o.token_ciphertext)).toBe("1234-5678-9012-3456-7890");
    const [notice] = await noticeRows(u.id);
    expect(notice.kind).toBe("token");
    expect(JSON.stringify(notice.params)).not.toContain("1234-5678");

    await sendNotices(deps);
    expect(messaging.sent[0]!.to).toBe(u.email);
    expect(messaging.sent[0]!.text).toContain("1234-5678-9012-3456-7890");
    expect(messaging.sent[0]!.text).not.toContain("45012345678");
  });

  it("prepaid delivered without a token: asked again until the token comes", async () => {
    const u = await user();
    const l = await line(u.id, { kind: "electricity", provider: "ikedc", schedule: "monthly", renewDay: 5, amountMinor: 500_000n, meterType: "prepaid" }, "45012345670");
    vending.vendScript = [{ kind: "delivered", partnerTxnId: "V1" }];
    await scanRenewals(deps);
    await processOrders(deps);
    expect((await orders(l.id))[0].state).toBe("vending");
    expect(await ledgerSum(db, u.id)).toBe(5_000_000n); // nothing settles yet

    vending.requeryScript = [{ kind: "delivered", partnerTxnId: "V1", token: "1111-2222-3333-4444-5555", units: "40" }];
    clock = new Date(T0.getTime() + CHECK_BACKOFF_MIN[0]! * MIN + 1);
    await processOrders(deps);
    const [o] = await orders(l.id);
    expect(o.state).toBe("notifying");
    expect(secrets.decrypt(o.token_ciphertext)).toBe("1111-2222-3333-4444-5555");
    expect(await ledgerSum(db, u.id)).toBe(5_000_000n - 500_000n - 10_000n);
  });

  it("postpaid: a bill payment, no token", async () => {
    const u = await user();
    await line(u.id, { kind: "electricity", provider: "ekedc", schedule: "monthly", renewDay: 5, amountMinor: 800_000n, meterType: "postpaid" }, "45012345671");
    await scanRenewals(deps);
    await processOrders(deps);
    expect(vending.calls.vend[0]).toMatchObject({ meterType: "postpaid" });
    expect((await noticeRows(u.id)).map((x) => x.kind)).toEqual(["bill_paid"]);
  });
});

describe("usage top-ups", () => {
  it("tops up when reported low, then waits for the next low reading", async () => {
    const u = await user();
    const l = await line(u.id, { kind: "data", provider: "mtn", schedule: "usage", threshold: 300, amountMinor: 100_000n, variationCode: "mtn-1gb", weeklyCapMinor: 300_000n }, "08031234561");
    expect(await scanRenewals(deps)).toBe(1);
    await processOrders(deps);
    expect((await orders(l.id))[0].trigger).toBe("usage");
    expect((await lineRow(l.id)).next_run_at).toBeNull();
  });

  it("never more than the weekly cap, and never twice within a few hours", async () => {
    const u = await user();
    const l = await line(u.id, { kind: "airtime", provider: "glo", schedule: "usage", threshold: 100, amountMinor: 100_000n, weeklyCapMinor: 200_000n }, "08051234567");
    const report = async () => db.query("UPDATE lines SET next_run_at = $2 WHERE id = $1", [l.id, clock]);

    expect(await scanRenewals(deps)).toBe(1);
    await processOrders(deps);
    await sendNotices(deps);

    clock = new Date(T0.getTime() + 1 * HOUR); // reported low again an hour later: too soon
    await report();
    expect(await scanRenewals(deps)).toBe(0);

    clock = new Date(T0.getTime() + 7 * HOUR);
    await report();
    expect(await scanRenewals(deps)).toBe(1);
    await processOrders(deps);
    await sendNotices(deps);

    clock = new Date(T0.getTime() + 14 * HOUR); // a third top-up would pass ₦2,000 this week
    await report();
    expect(await scanRenewals(deps)).toBe(0);
    expect((await noticeRows(u.id)).map((x) => x.kind)).toContain("weekly_cap");
    expect(vending.calls.vend).toHaveLength(2);
  });
});

describe("pots (D-083)", () => {
  it("a bill is paid from its own pot first, then free money, and the totals still add up", async () => {
    const u = await user(300_000n); // ₦3,000
    const l = await line(u.id, { kind: "airtime", provider: "mtn", schedule: "monthly", renewDay: 5, amountMinor: 200_000n }, "08039990001");
    await withTx(db, (tx) => movePot(tx, { userId: u.id, lineId: l.id, amountMinor: 150_000n, currency: "NGN", key: "test:pot1", actor: "test" }));
    expect(await potBalance(db, l.id)).toBe(150_000n);
    expect(await ledgerSum(db, u.id)).toBe(300_000n);

    await scanRenewals(deps);
    await processOrders(deps);
    // ₦2,000 + ₦30 fee: ₦1,500 from the pot, ₦530 from free money.
    expect(await potBalance(db, l.id)).toBe(0n);
    expect(await freeBalance(db, u.id)).toBe(300_000n - 150_000n - 53_000n);
    expect(await ledgerSum(db, u.id)).toBe(300_000n - 203_000n);
  });

  it("money in one bill's pot never pays another bill", async () => {
    const u = await user(300_000n);
    const saved = await line(u.id, { kind: "electricity", provider: "ikedc", schedule: "monthly", renewDay: 20, amountMinor: 300_000n, meterType: "prepaid", nextRunAt: null }, "45099990001");
    await withTx(db, (tx) => movePot(tx, { userId: u.id, lineId: saved.id, amountMinor: 250_000n, currency: "NGN", key: "test:pot2", actor: "test" }));
    const other = await line(u.id, { kind: "airtime", provider: "glo", schedule: "monthly", renewDay: 5, amountMinor: 100_000n }, "08059990001");
    // ₦3,000 in the account, but only ₦500 is free: the ₦1,000 airtime is not paid.
    expect(await scanRenewals(deps)).toBe(0);
    expect(vending.calls.vend).toHaveLength(0);
    expect((await noticeRows(u.id)).map((x) => x.kind)).toContain("insufficient");
    expect(await potBalance(db, saved.id)).toBe(250_000n);
    void other;
  });
});

describe("running low, sent to the person (D-092)", () => {
  const NOON = new Date("2026-11-10T11:00:00Z"); // noon in Lagos
  /** A data line whose readings fall 1,000 MB a day, ending with 1,200 MB left this morning. */
  async function lowDataLine(opts: { nextRunAt?: Date | null } = {}) {
    const u = await user();
    await setChannels(db, u.id, ["email"]);
    const l = await line(u.id, { kind: "data", provider: "mtn", schedule: "usage", threshold: 0, amountMinor: 150_000n, nextRunAt: opts.nextRunAt ?? null }, "08031230001");
    for (let k = 0; k < 5; k++) await insertReading(db, l.id, 5_200 - 1_000 * k, new Date(NOON.getTime() - (4 - k) * 86_400_000 - 4 * 3_600_000));
    return { u, l };
  }

  it("tells the person once a day, by their channel, as a formatted email", async () => {
    clock = NOON;
    const { u, l } = await lowDataLine();
    expect(await remindRunningLow(deps)).toBe(1);
    expect(await remindRunningLow(deps)).toBe(0); // not twice
    const rows = (await noticeRows(u.id)).filter((x) => x.kind === "running_low");
    expect(rows).toHaveLength(1);
    expect(rows[0].params).toMatchObject({ line: "My data", kind: "data" });
    expect((await lineRow(l.id)).low_reminded_at.toISOString()).toBe(NOON.toISOString());

    await sendNotices(deps);
    const email = messaging.sent.find((m) => m.channel === "email" && m.subject === "My data is running low")!;
    expect(email.text).toMatch(/^Hello,\n\nMy data will likely run low by .+\. Tap Top up now in the app, or add today's balance\./);
    expect(email.html).toContain("Open ConstantUnits");

    clock = new Date(NOON.getTime() + 86_400_000); // the next day: may remind again
    await insertReading(db, l.id, 400, new Date(clock.getTime() - 3_600_000));
    expect(await remindRunningLow(deps)).toBe(1);
  });

  it("stays quiet at night, and about a line that's already being topped up", async () => {
    clock = new Date("2026-11-10T22:30:00Z"); // 11:30 pm in Lagos
    await lowDataLine();
    expect(await remindRunningLow(deps)).toBe(0);
    clock = NOON;
    const due = await lowDataLine({ nextRunAt: new Date(NOON.getTime() - 60_000) });
    expect(await remindRunningLow(deps)).toBe(1); // the earlier line, now in waking hours; not the due one
    expect((await noticeRows(due.u.id)).filter((x) => x.kind === "running_low")).toHaveLength(0);
  });
});

describe("messages", () => {
  it("go on the user's first chosen channel that works", async () => {
    const u = await upsertUser(db, { privyDid: "did:privy:channels", email: "c@example.com", phoneE164: "+2348031234567" });
    await insertLedger(db, { userId: u.id, kind: "fund", amountMinor: 1_000_000n, currency: "NGN", idempotencyKey: "test:chfund", actor: "test" });
    await setChannels(db, u.id, ["whatsapp", "sms", "email"]);
    await line(u.id, { kind: "airtime", provider: "mtn", schedule: "monthly", renewDay: 5, amountMinor: 100_000n }, "08031234599");
    await scanRenewals(deps);
    await processOrders(deps);
    await sendNotices(deps);
    expect(messaging.sent[0]).toMatchObject({ channel: "sms", to: "+2348031234567" }); // WhatsApp isn't connected yet
    expect(isGsm7(messaging.sent[0]!.text)).toBe(true); // INV-24: no "₦" or "•" doubling the cost
  });

  it("go to the linked Telegram chat, and an electricity token is also sent by SMS as the backup", async () => {
    const tgSent: { chatId: string; text: string }[] = [];
    const tg = { channels: [...messaging.channels, "telegram"] as const, send: async (channel: string, to: string, subject: string, text: string) => {
      if (channel === "telegram") {
        tgSent.push({ chatId: to, text });
        return { providerId: "tg" };
      }
      return messaging.send(channel as "email" | "sms", to, subject, text);
    } };
    const u = await upsertUser(db, { privyDid: "did:privy:tgworker", email: "t@example.com", phoneE164: "+2348031230000" });
    await db.query("UPDATE users SET telegram_chat_id = '4242', channels = '{telegram,sms}' WHERE id = $1", [u.id]);
    await insertLedger(db, { userId: u.id, kind: "fund", amountMinor: 2_000_000n, currency: "NGN", idempotencyKey: "test:tgfund", actor: "test" });
    await line(u.id, { kind: "electricity", provider: "ikedc", schedule: "monthly", renewDay: 5, amountMinor: 500_000n, meterType: "prepaid" }, "45012349999");
    await scanRenewals(deps);
    await processOrders(deps);
    await sendNotices({ ...deps, messaging: tg as unknown as Deps["messaging"] });
    expect(tgSent).toHaveLength(1);
    expect(tgSent[0]).toMatchObject({ chatId: "4242" });
    expect(tgSent[0]!.text).toContain("1234-5678-9012-3456-7890");
    expect(messaging.sent).toEqual([expect.objectContaining({ channel: "sms", to: "+2348031230000" })]);
    // INV-24: the token SMS is one GSM-7 message, with the token intact; Telegram keeps the naira sign.
    const sms = messaging.sent[0]!.text;
    expect(isGsm7(sms)).toBe(true);
    expect(smsParts(sms)).toBe(1);
    expect(sms).toContain("1234-5678-9012-3456-7890");
    expect(sms).toContain("N5,000");
    expect(tgSent[0]!.text).toContain("₦5,000");
  });

  it("subscriptions are tracked, never paid", async () => {
    const u = await user();
    await line(u.id, { kind: "subscription", provider: "chatgpt", schedule: "none", currency: "USD", capMinor: 2_000n, nextRunAt: T0 }, "a@example.com");
    expect(await scanRenewals(deps)).toBe(0);
  });
});
