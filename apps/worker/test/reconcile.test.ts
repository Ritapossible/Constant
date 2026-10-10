/** Reconciliation (D-066): clean books pass; any disagreement switches payments off and pages a person. */
import { Secrets, flag, freshDatabase, insertLedger, insertLine, setVendingEnabled, testKeyB64, upsertUser, type Db } from "@constant/db";
import { FakeCableVending, FakeMessaging } from "@constant/partners";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { processOrders, reconcileBooks, scanRenewals, sendNotices, silentLog, type Deps } from "../src/index.js";

let db: Db;
let drop: () => Promise<void>;
let deps: Deps;
const vending = new FakeCableVending();
const secrets = new Secrets({ encryption: [{ id: "k1", key: Buffer.from(testKeyB64(), "base64") }], hmac: Buffer.from(testKeyB64(), "base64") });
const T0 = new Date("2026-11-14T06:00:00Z");

beforeAll(async () => {
  ({ db, drop } = await freshDatabase());
  deps = { db, vending, messaging: new FakeMessaging(), secrets, log: silentLog, now: () => T0, fallbackPhone: "0" };
  await setVendingEnabled(db, true, "test", "tests");
  const user = await upsertUser(db, { privyDid: "did:privy:recon", email: "r@example.com" });
  await insertLedger(db, { userId: user.id, kind: "fund", amountMinor: 5_000_000n, currency: "NGN", idempotencyKey: "recon:fund", actor: "test" });
  vending.decoders.set("7012345678", { customerName: "A", plan: "Compact", renewalAmountMinor: 1_995_000n, dueAt: new Date("2026-11-14T23:00:00Z") });
  await insertLine(db, {
    userId: user.id, kind: "tv", provider: "dstv", refCiphertext: secrets.encrypt("7012345678"), refHmac: "h", refLast4: "5678", customerName: "A", planName: null,
    nickname: "TV", currency: "NGN", capMinor: 2_500_000n, dueAt: new Date("2026-11-14T23:00:00Z"), nextRunAt: T0,
  });
  await scanRenewals(deps);
  await processOrders(deps);
  await sendNotices(deps);
});
afterAll(async () => drop?.());

describe("reconciliation", () => {
  it("clean books pass and leave payments on", async () => {
    expect(await reconcileBooks(deps, true)).toEqual({ ran: true, ok: true, mismatches: 0 });
    expect(await flag(db, "vending_enabled")).toBe(true);
  });

  it("the partner reporting a reversal stops all payments and pages a person", async () => {
    // The database stamps rows with the real clock; this test runs on a fixed one. Align them.
    await db.query("UPDATE orders SET updated_at = $1", [T0]);
    vending.requeryScript = [{ kind: "reversed", detail: "TRANSACTION REVERSAL TO WALLET" }];
    expect(await reconcileBooks(deps, true)).toMatchObject({ ran: true, ok: false, mismatches: 1 });
    expect(await flag(db, "vending_enabled")).toBe(false);
    expect(await flag(db, "dollar_charges_enabled", true)).toBe(false);
    const alert = await db.query("SELECT detail FROM ops_alerts WHERE kind = 'reconciliation_mismatch'");
    expect(alert.rows[0].detail.first[0].kind).toBe("partner_disagrees");
  });

  it("a ledger entry nobody can explain is caught", async () => {
    await setVendingEnabled(db, true, "test", "reset");
    const o = await db.query("SELECT id, user_id FROM orders LIMIT 1");
    await insertLedger(db, { userId: o.rows[0].user_id, orderId: o.rows[0].id, kind: "vend", amountMinor: -1n, currency: "NGN", idempotencyKey: "rogue", actor: "rogue" });
    const r = await reconcileBooks(deps, true);
    expect(r.ok).toBe(false);
    const run = await db.query("SELECT mismatches FROM reconciliation_runs ORDER BY id DESC LIMIT 1");
    expect(run.rows[0].mismatches[0].kind).toBe("paid_without_ledger");
  });

  it("runs on request, and nightly only after 02:00 Lagos and once a night", async () => {
    await db.query("INSERT INTO reconciliation_runs (actor) VALUES ('ops:test')");
    expect((await reconcileBooks(deps)).ran).toBe(true); // the requested one
    const night = { ...deps, now: () => new Date("2026-11-15T00:30:00Z") }; // 01:30 Lagos
    expect((await reconcileBooks(night)).ran).toBe(false);
    const later = { ...deps, now: () => new Date("2026-11-15T01:30:00Z") }; // 02:30 Lagos
    expect((await reconcileBooks(later)).ran).toBe(true);
    expect((await reconcileBooks(later)).ran).toBe(false);
  });
});
