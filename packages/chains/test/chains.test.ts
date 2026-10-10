import { Keypair, Networks, TransactionBuilder } from "@stellar/stellar-sdk";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { EVM_CHAINS, STABLES, buildAnchorTx, evmAddress, formatUnits6, leafHash, merkle, receiptLeaf, receiptLeafData, stableFor, verifyProof } from "../src/index.js";

describe("chain facts", () => {
  it("only the three accepted stables, all 6 decimals, USDT on Base only (INV-46)", () => {
    expect(STABLES.map((s) => s.key)).toEqual(["base-usdc", "base-usdt", "arc-usdc"]);
    expect(STABLES.every((s) => s.decimals === 6)).toBe(true);
    expect(STABLES.filter((s) => s.chain === "arc").map((s) => s.symbol)).toEqual(["USDC"]);
    expect(EVM_CHAINS.arc.chainId).toBe(5042);
    expect(EVM_CHAINS.base.chainId).toBe(8453);
  });
  it("matches token addresses case-insensitively and per chain", () => {
    expect(stableFor("base", "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913")?.key).toBe("base-usdc");
    expect(stableFor("arc", "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913")).toBeNull();
    expect(stableFor("base", "0x0000000000000000000000000000000000000001")).toBeNull();
  });
  it("validates addresses", () => {
    expect(evmAddress("0x833589fcd6edb6e08f4c7c32d4f71b54bda02913")).toBe("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
    expect(evmAddress("0x123")).toBeNull();
    expect(evmAddress(42)).toBeNull();
  });
  it("formats 6-decimal amounts exactly", () => {
    expect(formatUnits6(20_000_000n)).toBe("20.00");
    expect(formatUnits6(1_234_567_890n)).toBe("1,234.56");
  });
});

describe("merkle", () => {
  it("every leaf's proof verifies against the root; a changed leaf does not", () => {
    fc.assert(
      fc.property(fc.array(fc.string(), { minLength: 1, maxLength: 40 }), (items) => {
        const leaves = items.map((s, i) => leafHash(`${i}:${s}`));
        const { root, proofs } = merkle(leaves);
        leaves.forEach((l, i) => expect(verifyProof(l, proofs[i]!, root)).toBe(true));
        expect(verifyProof(leafHash("not in the tree"), proofs[0]!, root)).toBe(false);
      }),
    );
  });
  it("a single leaf is its own root", () => {
    const l = leafHash("x");
    expect(merkle([l])).toEqual({ root: l, proofs: [[]] });
  });
  it("leaves and nodes can't be confused", () => {
    const a = leafHash("a");
    const b = leafHash("b");
    const { root } = merkle([a, b]);
    expect(leafHash(root)).not.toBe(root);
  });
});

describe("receipts", () => {
  const facts = { receiptId: "0Abc", amountMinor: 1_995_000n, currency: "NGN", provider: "dstv", last4: "5678", settledAt: new Date("2026-11-14T06:01:00Z") };
  it("commit to the receipt id, amount and date, nothing personal", () => {
    expect(receiptLeafData(facts)).toBe("constant.receipt.v1|0Abc|1995000|NGN|dstv|5678|2026-11-14T06:01:00.000Z");
    expect(receiptLeaf(facts)).not.toBe(receiptLeaf({ ...facts, amountMinor: 1_995_001n }));
  });
});

describe("Stellar anchor transaction", () => {
  it("carries the root as a memo hash, moves no money, and is signed by Constant's key", () => {
    const kp = Keypair.random();
    const root = leafHash("root");
    const tx = buildAnchorTx({ accountId: kp.publicKey(), sequence: "123" }, root, "testnet", kp.secret());
    const parsed = TransactionBuilder.fromXDR(tx.toXDR(), Networks.TESTNET);
    expect("memo" in parsed && parsed.memo.type).toBe("hash");
    expect("memo" in parsed && Buffer.from(parsed.memo.value as Buffer).toString("hex")).toBe(root);
    expect("operations" in parsed && parsed.operations.map((o) => o.type)).toEqual(["bumpSequence"]);
    expect(kp.verify(tx.hash(), tx.signatures[0]!.signature())).toBe(true);
  });
  it("refuses a root that isn't 32 bytes", () => {
    const kp = Keypair.random();
    expect(() => buildAnchorTx({ accountId: kp.publicKey(), sequence: "1" }, "abc", "testnet", kp.secret())).toThrow();
  });
});
