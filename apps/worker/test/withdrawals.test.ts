/** Sending withdrawals (D-067): saved before sent, idempotent by reference, refunded only on a definite failure. */
import { Secrets, freshDatabase, insertLedger, insertWithdrawal, ledgerSum, setFlag, testKeyB64, upsertUser, withTx, type Db } from "@constant/db";
import { FakeCableVending, FakeFunding, FakeMessaging } from "@constant/partners";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { processWithdrawals, silentLog, type Deps } from "../src/index.js";

let db: Db;
let drop: () => Promise<void>;
let clock = new Date("2026-11-14T08:00:00Z");
let payouts: FakeFunding;
let deps: Deps;
let n = 0;

beforeAll(async () => {
  ({ db, drop } = await freshDatabase());
});
afterAll(async () => drop?.());

async function request(amount = 1_000_000n) {
  n += 1;
  payouts = new FakeFunding();
  deps = {
    db, vending: new FakeCableVending(), messaging: new FakeMessaging(), log: silentLog, now: () => clock, fallbackPhone: "0", payouts,
    secrets: new Secrets({ encryption: [{ id: "k1", key: Buffer.from(testKeyB64(), "base64") }], hmac: Buffer.from(testKeyB64(), "base64") }),
  };
  // Earlier tests' withdrawals must not become due during this one.
  await db.query("UPDATE withdrawals SET status = 'succeeded' WHERE status IN ('requested', 'sent')");
  const u = await upsertUser(db, { privyDid: `did:privy:w${n}` });
  await insertLedger(db, { userId: u.id, kind: "fund", amountMinor: 5_000_000n, currency: "NGN", idempotencyKey: `w:fund:${n}`, actor: "t" });
  const id = randomUUID();
  await withTx(db, (tx) => insertWithdrawal(tx, { id, userId: u.id, amountMinor: amount, currency: "NGN", recipientCode: "RCP_1", reference: `cw_${id}` }));
  await db.query("UPDATE withdrawals SET next_check_at = $1 WHERE id = $2", [clock, id]);
  return { user: u, id };
}
const status = async (id: string) => (await db.query("SELECT status FROM withdrawals WHERE id = $1", [id])).rows[0].status;
const later = (min: number) => (clock = new Date(clock.getTime() + min * 60_000));

describe("withdrawals worker", () => {
  it("waits while payouts are off, without refunding", async () => {
    await setFlag(db, "payouts_enabled", false, "t", "t");
    const { user, id } = await request();
    await processWithdrawals(deps, payouts);
    expect(await status(id)).toBe("requested");
    expect(await ledgerSum(db, user.id)).toBe(4_000_000n);
    await setFlag(db, "payouts_enabled", true, "t", "t");
  });

  it("sends once, then confirms by verifying the reference", async () => {
    const { id } = await request();
    await processWithdrawals(deps, payouts);
    expect(await status(id)).toBe("sent");
    expect(payouts.transfers.size).toBe(1);
    [...payouts.transfers.values()][0]!.state = "succeeded";
    later(6); // first check 5 minutes after sending
    await processWithdrawals(deps, payouts);
    expect(await status(id)).toBe("succeeded");
    expect(payouts.transfers.size).toBe(1);
  });

  it("crash after sending: verified, never sent twice", async () => {
    const { id } = await request();
    payouts.transferScript = ["throw"];
    await processWithdrawals(deps, payouts);
    expect(await status(id)).toBe("sent");
    later(3);
    await processWithdrawals(deps, payouts);
    later(6);
    await processWithdrawals(deps, payouts);
    expect(payouts.transfers.size).toBe(1);
  });

  it("a definite failure gives the money back once", async () => {
    const { user, id } = await request();
    payouts.transferScript = [{ kind: "failed", detail: "Insufficient balance" }];
    await processWithdrawals(deps, payouts);
    expect(await status(id)).toBe("failed");
    expect(await ledgerSum(db, user.id)).toBe(5_000_000n);
    later(60);
    await processWithdrawals(deps, payouts);
    expect(await ledgerSum(db, user.id)).toBe(5_000_000n);
  });

  it("an OTP request goes to a person and keeps the money held", async () => {
    const { user, id } = await request();
    payouts.transferScript = [{ kind: "needs_otp" }];
    await processWithdrawals(deps, payouts);
    expect(await status(id)).toBe("needs_human");
    expect(await ledgerSum(db, user.id)).toBe(4_000_000n);
  });
});
