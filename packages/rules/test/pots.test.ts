import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { availableForBill, decidePotMove, freeCommitted, splitDraw } from "../src/index.js";

const amt = fc.bigInt({ min: 0n, max: 10_000_000_000n });

describe("pots (D-083)", () => {
  it("a payment takes from its pot first, then free money, and adds up exactly", () => {
    expect(splitDraw(500n, 800n)).toEqual({ fromPot: 500n, fromFree: 0n });
    expect(splitDraw(500n, 200n)).toEqual({ fromPot: 200n, fromFree: 300n });
    fc.assert(
      fc.property(amt, amt, (need, pot) => {
        const d = splitDraw(need, pot);
        expect(d.fromPot + d.fromFree).toBe(need);
        expect(d.fromPot).toBeLessThanOrEqual(pot);
        expect(d.fromPot >= 0n && d.fromFree >= 0n).toBe(true);
      }),
    );
  });

  it("another bill's pot is never available to a bill", () => {
    fc.assert(
      fc.property(amt, amt, amt, amt, (myPot, otherPot, free, need) => {
        const committed = freeCommitted([{ needMinor: need, potMinor: otherPot }]);
        const a = availableForBill({ potMinor: myPot, freeMinor: free, freeCommittedMinor: committed });
        // Whatever the other pot holds, this bill can use at most its own pot and the free money.
        expect(a).toBeLessThanOrEqual(myPot + free);
        expect(availableForBill({ potMinor: myPot, freeMinor: free, freeCommittedMinor: committed })).toBe(
          availableForBill({ potMinor: myPot, freeMinor: free, freeCommittedMinor: freeCommitted([{ needMinor: need, potMinor: otherPot }]) }),
        );
      }),
    );
  });

  it("an open order uses its own pot before it claims free money", () => {
    expect(freeCommitted([{ needMinor: 1000n, potMinor: 1500n }])).toBe(0n);
    expect(freeCommitted([{ needMinor: 1000n, potMinor: 400n }, { needMinor: 300n, potMinor: 0n }])).toBe(900n);
    expect(availableForBill({ potMinor: 0n, freeMinor: 500n, freeCommittedMinor: 900n })).toBe(0n);
  });

  it("moves never take more than is there, and a pot can't be emptied mid-payment", () => {
    const base = { freeAvailableMinor: 1000n, potMinor: 300n, billOpen: true, paymentInProgress: false };
    expect(decidePotMove({ ...base, direction: "in", amountMinor: 1000n })).toEqual({ kind: "move", amountMinor: 1000n });
    expect(decidePotMove({ ...base, direction: "in", amountMinor: 1001n })).toEqual({ kind: "refuse", reason: "not_enough_free" });
    expect(decidePotMove({ ...base, direction: "out", amountMinor: 301n })).toEqual({ kind: "refuse", reason: "not_enough_in_pot" });
    expect(decidePotMove({ ...base, direction: "out", amountMinor: 1n, paymentInProgress: true })).toEqual({ kind: "refuse", reason: "payment_in_progress" });
    expect(decidePotMove({ ...base, direction: "in", amountMinor: 0n })).toEqual({ kind: "refuse", reason: "non_positive" });
    expect(decidePotMove({ ...base, direction: "in", amountMinor: 1n, billOpen: false })).toEqual({ kind: "refuse", reason: "bill_closed" });
    fc.assert(
      fc.property(amt, amt, amt, fc.boolean(), (move, free, pot, into) => {
        const d = decidePotMove({ direction: into ? "in" : "out", amountMinor: move, freeAvailableMinor: free, potMinor: pot, billOpen: true, paymentInProgress: false });
        if (d.kind === "move") expect(d.amountMinor).toBeLessThanOrEqual(into ? free : pot);
      }),
    );
  });
});
