/** The app's checks before a Stellar signature (D-089), on a real request captured from testnet. */
import { readFileSync } from "node:fs";
import { Keypair, Networks, Operation, TransactionBuilder, Account, Asset, xdr } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { STELLAR_USDC, checkLinkMessage, checkMandatePreimage, checkOnboarding, formatStellarUnits, pinnedUsdc, stellarMessageHash, toStellarAccount } from "../src/index.js";

const fx = JSON.parse(readFileSync(new URL("./fixtures-stellar-testnet.json", import.meta.url), "utf8"));
const mandate = { network: "testnet" as "testnet" | "public", account: fx.owner, contract: fx.contract, usdcContract: fx.usdcContract };

describe("checking a mandate before signing", () => {
  it("accepts the real request and reads what it allows", () => {
    const r = checkMandatePreimage(fx.draft.preimage, fx.draft.payload, mandate);
    expect(r).toEqual({
      ok: true,
      seen: { capUnits: 199_700_000n, periodSecs: 2_592_000, endAt: fx.draft.terms.endAt, allowanceUnits: 798_800_000n, validUntilLedger: fx.draft.validUntilLedger },
    });
  });

  it("refuses it for another contract, another account, another network, or a payload that doesn't match", () => {
    const refuse = (over: Partial<typeof mandate>, payload = fx.draft.payload) => checkMandatePreimage(fx.draft.preimage, payload, { ...mandate, ...over });
    expect(refuse({ contract: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC" })).toMatchObject({ ok: false, reason: "it isn't ConstantUnits' mandate contract" });
    expect(refuse({ account: Keypair.random().publicKey() })).toMatchObject({ ok: false });
    expect(refuse({ network: "public" })).toMatchObject({ ok: false, reason: "it's for a different network" });
    expect(refuse({ usdcContract: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC" })).toMatchObject({ ok: false, reason: "it isn't a USDC allowance" });
    expect(refuse({}, "00".repeat(32))).toMatchObject({ ok: false, reason: "it doesn't match what you'd sign" });
    expect(checkMandatePreimage("not xdr", fx.draft.payload, mandate)).toMatchObject({ ok: false });
  });
});

describe("checking onboarding before signing", () => {
  const e = { network: "testnet" as const, account: fx.fresh, usdcIssuer: STELLAR_USDC.testnet.issuer };
  it("accepts the real sponsored transaction", () => {
    expect(checkOnboarding(fx.onboarding.xdr, fx.onboarding.hash, e)).toBeNull();
  });
  it("refuses one for another account, another issuer, or with anything extra", () => {
    expect(checkOnboarding(fx.onboarding.xdr, fx.onboarding.hash, { ...e, account: Keypair.random().publicKey() })).not.toBeNull();
    expect(checkOnboarding(fx.onboarding.xdr, fx.onboarding.hash, { ...e, usdcIssuer: Keypair.random().publicKey() })).toBe("it isn't the USDC trustline");
    // The same shape plus a payment out of the user's account.
    const sponsor = Keypair.random();
    const tx = new TransactionBuilder(new Account(sponsor.publicKey(), "1"), { fee: "100", networkPassphrase: Networks.TESTNET })
      .addOperation(Operation.beginSponsoringFutureReserves({ sponsoredId: fx.fresh }))
      .addOperation(Operation.changeTrust({ asset: new Asset("USDC", STELLAR_USDC.testnet.issuer), source: fx.fresh }))
      .addOperation(Operation.endSponsoringFutureReserves({ source: fx.fresh }))
      .addOperation(Operation.payment({ destination: sponsor.publicKey(), asset: new Asset("USDC", STELLAR_USDC.testnet.issuer), amount: "10", source: fx.fresh }))
      .setTimeout(60)
      .build();
    expect(checkOnboarding(tx.toXdr(), Buffer.from(tx.hash()).toString("hex"), e)).toBe("it does more than open your account");
  });
});

describe("checking the link message", () => {
  it("names the account and hashes to the payload", () => {
    const acct = Keypair.random().publicKey();
    const m = `ConstantUnits: link ${acct} to my account. Code 1234`;
    expect(checkLinkMessage(m, acct, stellarMessageHash(m))).toBeNull();
    expect(checkLinkMessage(m, Keypair.random().publicKey(), stellarMessageHash(m))).not.toBeNull();
    expect(checkLinkMessage(m, acct, "00".repeat(32))).not.toBeNull();
  });
});

describe("pins and formats", () => {
  it("pins Circle's USDC contract and reads accounts and amounts", () => {
    expect(pinnedUsdc("testnet").contract).toBe(fx.usdcContract);
    const kp = Keypair.random();
    expect(toStellarAccount(kp.publicKey())).toBe(kp.publicKey());
    expect(toStellarAccount("0x" + Buffer.from(kp.rawPublicKey()).toString("hex"))).toBe(kp.publicKey());
    expect(toStellarAccount("nope")).toBeNull();
    expect(formatStellarUnits(199_700_000n)).toBe("19.97");
  });
});

void xdr;
