import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { KYC_TIERS, decideKyc, inboundOverLimit, isBvn, isNuban, type KycTier } from "../src/index.js";

const amt = fc.bigInt({ min: 0n, max: 1_000_000_000n });
const tier = fc.constantFrom<KycTier>(0, 1, 2);
const usage = fc.record({ inLast24hMinor: amt, withdrawnLast24hMinor: amt, balanceMinor: amt });

describe("KYC tiers (D-086)", () => {
  it("tiers only ever grow in what they allow", () => {
    for (const [a, b] of [[0, 1], [1, 2]] as const) {
      expect(KYC_TIERS[b].dailyInMinor >= KYC_TIERS[a].dailyInMinor).toBe(true);
      expect(KYC_TIERS[b].dailyWithdrawMinor >= KYC_TIERS[a].dailyWithdrawMinor).toBe(true);
      const capA = KYC_TIERS[a].maxBalanceMinor, capB = KYC_TIERS[b].maxBalanceMinor;
      expect(capB === null || (capA !== null && capB >= capA)).toBe(true);
    }
  });

  it("a top-up is never allowed past the daily limit or the balance cap", () => {
    fc.assert(
      fc.property(tier, amt, usage, (t, a, u) => {
        const d = decideKyc(t, { kind: "topup", amountMinor: a }, u);
        const l = KYC_TIERS[t];
        if (d.kind === "allow" && a > 0n) {
          expect(u.inLast24hMinor + a <= l.dailyInMinor).toBe(true);
          if (l.maxBalanceMinor !== null) expect(u.balanceMinor + a <= l.maxBalanceMinor).toBe(true);
        }
        if (d.kind === "refuse") {
          // What it says is still allowed really is.
          if (d.roomMinor > 0n) expect(decideKyc(t, { kind: "topup", amountMinor: d.roomMinor }, u).kind).toBe("allow");
          expect(d.needTier >= 0).toBe(true);
        }
      }),
    );
  });

  it("a withdrawal needs a verified identity and stays within the daily limit", () => {
    expect(decideKyc(0, { kind: "withdraw", amountMinor: 100n }, { inLast24hMinor: 0n, withdrawnLast24hMinor: 0n, balanceMinor: 1_000n })).toMatchObject({ kind: "refuse", reason: "verify_identity", needTier: 1 });
    fc.assert(
      fc.property(tier, amt, usage, (t, a, u) => {
        const d = decideKyc(t, { kind: "withdraw", amountMinor: a }, u);
        if (d.kind === "allow" && a > 0n) expect(u.withdrawnLast24hMinor + a <= KYC_TIERS[t].dailyWithdrawMinor).toBe(true);
      }),
    );
  });

  it("only verified people get an account number", () => {
    const u = { inLast24hMinor: 0n, withdrawnLast24hMinor: 0n, balanceMinor: 0n };
    expect(decideKyc(0, { kind: "account_number" }, u)).toMatchObject({ kind: "refuse", reason: "verify_identity", needTier: 1 });
    expect(decideKyc(1, { kind: "account_number" }, u).kind).toBe("allow");
  });

  it("names the tier to reach for a large top-up", () => {
    const u = { inLast24hMinor: 0n, withdrawnLast24hMinor: 0n, balanceMinor: 0n };
    expect(decideKyc(0, { kind: "topup", amountMinor: 10_000_000n }, u)).toMatchObject({ kind: "refuse", reason: "daily_limit", needTier: 1, roomMinor: 5_000_000n });
    expect(decideKyc(1, { kind: "topup", amountMinor: 10_000_000n }, u).kind).toBe("allow");
  });

  it("flags money that arrived past the limits, and only that", () => {
    fc.assert(
      fc.property(tier, amt, usage, (t, a, u) => {
        const over = inboundOverLimit(t, a, u);
        const allowed = decideKyc(t, { kind: "topup", amountMinor: a }, u).kind === "allow";
        if (a > 0n) expect(over).toBe(!allowed);
      }),
    );
  });

  it("checks BVN and account number formats", () => {
    expect(isBvn("22212345678")).toBe(true);
    expect(isBvn("2221234567")).toBe(false);
    expect(isNuban("0123456789")).toBe(true);
    expect(isNuban("01234567890")).toBe(false);
  });
});
