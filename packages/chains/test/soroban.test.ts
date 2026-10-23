import { Keypair } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import {
  FakeStellarRail,
  contractError,
  fromStellarUnits,
  isStellarAccount,
  parseStellarSignature,
  stellarMessageHash,
  toStellarUnits,
  verifyStellarSignature,
} from "../src/index.js";

describe("Stellar helpers (D-085)", () => {
  it("converts between Constant's 6 decimals and Stellar's 7 exactly, rounding down", () => {
    expect(toStellarUnits(19_970_000n)).toBe(199_700_000n);
    expect(fromStellarUnits(199_700_009n)).toBe(19_970_000n);
  });

  it("verifies a signature only by the right key, over the right 32 bytes", () => {
    const kp = Keypair.random();
    const payload = "ab".repeat(32);
    const sig = Buffer.from(kp.sign(Buffer.from(payload, "hex"))).toString("hex");
    expect(verifyStellarSignature(kp.publicKey(), payload, sig)).toBe(true);
    expect(verifyStellarSignature(Keypair.random().publicKey(), payload, sig)).toBe(false);
    expect(verifyStellarSignature(kp.publicKey(), "cd".repeat(32), sig)).toBe(false);
    expect(verifyStellarSignature(kp.publicKey(), payload, "00")).toBe(false);
    expect(verifyStellarSignature("not-an-account", payload, sig)).toBe(false);
  });

  it("reads signatures as wallets return them: hex or base64", () => {
    const hex = "0f".repeat(64);
    expect(parseStellarSignature(hex)).toBe(hex);
    expect(parseStellarSignature(Buffer.from(hex, "hex").toString("base64"))).toBe(hex);
    expect(parseStellarSignature("0f")).toBeNull();
    expect(parseStellarSignature(42)).toBeNull();
  });

  it("hashes messages the way wallets sign them (SEP-53)", () => {
    expect(stellarMessageHash("Hello, World!")).toMatch(/^[0-9a-f]{64}$/);
    expect(stellarMessageHash("a")).not.toBe(stellarMessageHash("b"));
  });

  it("names the contract's errors", () => {
    expect(contractError("HostError: Error(Contract, #7)\n more")).toBe("OverCap (#7)");
    expect(contractError("HostError: Error(Contract, #8)")).toBe("DuplicateCharge (#8)");
    expect(contractError("something else\nsecond line")).toBe("something else");
  });

  it("recognises Stellar accounts", () => {
    expect(isStellarAccount(Keypair.random().publicKey())).toBe(true);
    expect(isStellarAccount("GABC")).toBe(false);
  });

  it("the fake follows the contract's rules: cap per period, one charge per id, revoke", async () => {
    let now = new Date("2026-11-01T00:00:00Z");
    const rail = new FakeStellarRail(() => now);
    const owner = Keypair.random().publicKey();
    rail.balances.set(owner, 100_000_000n);
    const id = "11".repeat(32);
    const draft = await rail.draftMandate({ owner, id, capMicro: 10_000_000n, periodSecs: 30 * 86_400, endAt: Math.floor(now.getTime() / 1000) + 90 * 86_400 });
    const send = async (p: { raw: string; hash: string }) => {
      await rail.broadcast(p.raw);
      return rail.status(p.hash);
    };
    expect(await send(await rail.prepareCreate(draft.terms, "entry"))).toBe("confirmed");
    expect(await send(await rail.prepareCharge(id, "aa".repeat(32), 6_000_000n))).toBe("confirmed");
    await expect(rail.prepareCharge(id, "aa".repeat(32), 1n)).rejects.toThrow(/DuplicateCharge/);
    await expect(rail.prepareCharge(id, "bb".repeat(32), 5_000_000n)).rejects.toThrow(/OverCap/);
    now = new Date(now.getTime() + 31 * 86_400_000);
    expect(await rail.remaining(id)).toBe(10_000_000n);
    expect(await send(await rail.prepareRevoke(id))).toBe("confirmed");
    await expect(rail.prepareCharge(id, "cc".repeat(32), 1n)).rejects.toThrow(/Revoked/);
    expect(rail.treasuryMicro).toBe(6_000_000n);
  });
});
