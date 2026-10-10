import { Secrets, freshDatabase, raiseOpsAlert, testKeyB64, type Db } from "@constant/db";
import { FakeCableVending, FakeMessaging } from "@constant/partners";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { notifyOps, silentLog, type Deps } from "../src/index.js";

let db: Db;
let drop: () => Promise<void>;
beforeAll(async () => {
  ({ db, drop } = await freshDatabase());
});
afterAll(async () => drop?.());

describe("ops alert email", () => {
  it("emails each alert once, pages in the subject; a failed send is retried, not lost", async () => {
    const messaging = new FakeMessaging();
    const deps: Deps = {
      db, vending: new FakeCableVending(), messaging, log: silentLog, now: () => new Date(), fallbackPhone: "0",
      secrets: new Secrets({ encryption: [{ id: "k1", key: Buffer.from(testKeyB64(), "base64") }], hmac: Buffer.from(testKeyB64(), "base64") }),
    };
    await raiseOpsAlert(db, "page", "order_needs_human", { orderId: "o1" });
    await raiseOpsAlert(db, "warn", "anchor_failing", {});
    messaging.failNext = 1;
    expect(await notifyOps(deps, "ops@constant.ng")).toBe(0);
    expect(await notifyOps(deps, "ops@constant.ng")).toBe(2);
    expect(await notifyOps(deps, "ops@constant.ng")).toBe(0);
    expect(messaging.sent).toHaveLength(1);
    expect(messaging.sent[0]).toMatchObject({ channel: "email", to: "ops@constant.ng", subject: "PAGE: order_needs_human" });
    expect(await notifyOps(deps, undefined)).toBe(0);
  });
});
