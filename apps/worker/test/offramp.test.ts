/** Float refill through Paycrest (D-068): only when low, one at a time, saved before every step; the sweep waits. */
import { FakePermissionChain, STABLES } from "@constant/chains";
import { Secrets, freshDatabase, testKeyB64, type Db } from "@constant/db";
import { FakeCableVending, FakeMessaging, FakeOfframp, FakeRates } from "@constant/partners";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { refillFloat, silentLog, sweepSpender, type Deps, type DollarDeps, type OfframpDeps } from "../src/index.js";

let db: Db;
let drop: () => Promise<void>;
let d: Deps;
let dd: DollarDeps;
let od: OfframpDeps;
let chain: FakePermissionChain;
let vending: FakeCableVending;
let offramp: FakeOfframp;
const USDC = STABLES.find((s) => s.key === "base-usdc")!.address;

beforeAll(async () => {
  ({ db, drop } = await freshDatabase());
});
afterAll(async () => drop?.());
beforeEach(async () => {
  await db.query("UPDATE offramps SET status = 'settled' WHERE status IN ('creating','created','funding','funded')");
  chain = new FakePermissionChain();
  vending = new FakeCableVending();
  offramp = new FakeOfframp();
  d = { db, vending, messaging: new FakeMessaging(), log: silentLog, now: () => new Date(), fallbackPhone: "0",
    secrets: new Secrets({ encryption: [{ id: "k1", key: Buffer.from(testKeyB64(), "base64") }], hmac: Buffer.from(testKeyB64(), "base64") }) };
  dd = { chain, rates: new FakeRates(), confirmations: 1n, screeningRequired: false, dailyLimitMicro: 10n ** 12n, floatMarginMinor: 0n, sweepMinMicro: 1n, treasury: "0x7777777777777777777777777777777777777777" };
  od = { offramp, rates: new FakeRates("1500"), recipient: { institution: "GTBINGLA", accountIdentifier: "0123456789", accountName: "VTPASS", memo: "float" }, lowWaterMinor: 20_000_000n, targetMinor: 100_000_000n, minOrderMicro: 20_000_000n };
  chain.balances.set(chain.spender.toLowerCase(), 600_000_000n); // $600 charged, on the spender
});

describe("float refill", () => {
  it("does nothing while the float is healthy", async () => {
    vending.float = 50_000_000n;
    expect(await refillFloat(d, dd, od)).toBe("float_ok");
  });

  it("low float: order → fund (hash saved first) → funded → settled, one at a time", async () => {
    vending.float = 5_000_000n; // ₦50,000, below ₦200,000
    expect(await refillFloat(d, dd, od)).toBe("created");
    const order = [...offramp.orders.values()][0]!;
    // Needs $633.34 to reach the target; capped at what the spender holds less room for fees ($600 − 1%).
    expect(order.amountMicro).toBe(594_000_000n);
    expect(await refillFloat(d, dd, od)).toBe("funding");
    const row = (await db.query("SELECT * FROM offramps WHERE status = 'funding'")).rows[0];
    expect(row.tx_hash).toBeTruthy();
    expect(await refillFloat(d, dd, od)).toBe("funded");
    expect(offramp.orders.size).toBe(1);
    order.status = "settled";
    expect(await refillFloat(d, dd, od)).toBe("settled");
  });

  it("fees larger than the room left: the order is dropped, nothing is sent", async () => {
    vending.float = 0n;
    od = { ...od, targetMinor: 10n ** 12n };
    offramp.feeMicro = 50_000_000n; // $50 of fees, more than the $6 kept back
    expect(await refillFloat(d, dd, od)).toBe("too_small");
    expect(chain.txs.size).toBe(0);
  });

  it("the sweep keeps charged USDC while the float is low", async () => {
    vending.float = 5_000_000n;
    expect(await sweepSpender(d, dd, od)).toBe("kept_for_float");
    vending.float = 50_000_000n;
    expect(await sweepSpender(d, dd, od)).toBe("sent");
    expect(await chain.balanceOf(USDC, dd.treasury!)).toBe(600_000_000n);
  });
});
