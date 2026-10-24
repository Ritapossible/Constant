/**
 * What the app checks before a user's key signs anything for Stellar (D-085, D-089). The server proposes; the app
 * decodes the exact bytes it is asked to sign and refuses unless they say what the screen says. So even a compromised
 * API can't get a signature for a different contract, a different account, more money, or someone else's benefit.
 *
 * Browser-safe: only @stellar/stellar-sdk, no network calls.
 */
import { Address, Asset, Networks, StrKey, TransactionBuilder, hash, scValToNative, xdr, type Transaction } from "@stellar/stellar-sdk";
import { STELLAR_USDC } from "./config.js";

export type StellarNet = "testnet" | "public";
const PASSPHRASE: Record<StellarNet, string> = { testnet: Networks.TESTNET, public: Networks.PUBLIC };

// Plain Uint8Array helpers: this runs in the browser, which has no Node buffers.
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const utf8 = (s: string) => new TextEncoder().encode(s);
const sha256hex = (b: Uint8Array) => hex(hash(b as never));

/** The link message must name this account and hash (SEP-53) to exactly the payload to sign. */
export function checkLinkMessage(message: string, account: string, payloadHex: string): string | null {
  if (!message.startsWith("ConstantUnits: link ") || !message.includes(account)) return "the message doesn't name your account";
  if (sha256hex(utf8(`Stellar Signed Message:\n${message}`)) !== payloadHex.toLowerCase()) return "the message doesn't match what you'd sign";
  return null;
}

/**
 * The onboarding transaction: someone else (ConstantUnits) is the source and pays the fee, and the only things it does
 * for this account are open it with no XLM, add a trustline for USDC from its pinned issuer, and sponsor both.
 */
export function checkOnboarding(
  xdrB64: string,
  hashHex: string,
  e: { network: StellarNet; account: string; usdcIssuer: string },
): string | null {
  let tx: Transaction;
  try {
    tx = TransactionBuilder.fromXDR(xdrB64, PASSPHRASE[e.network]) as Transaction;
  } catch {
    return "it isn't a Stellar transaction";
  }
  if (hex(tx.hash()) !== hashHex.toLowerCase()) return "it doesn't match what you'd sign";
  if (!("operations" in tx) || tx.source === e.account) return "it would spend from your account";
  const ops = tx.operations;
  let i = 0;
  const next = () => ops[i++] as unknown as Record<string, unknown> | undefined;
  let op = next();
  if (op?.type !== "beginSponsoringFutureReserves" || op.sponsoredId !== e.account || op.source === e.account) return "it doesn't sponsor your account";
  op = next();
  if (op?.type === "createAccount") {
    if (op.destination !== e.account || Number(op.startingBalance) !== 0) return "it opens a different account";
    op = next();
  }
  const asset = op?.line as { code?: string; issuer?: string } | undefined;
  if (op?.type !== "changeTrust" || op.source !== e.account || asset?.code !== "USDC" || asset?.issuer !== e.usdcIssuer) return "it isn't the USDC trustline";
  op = next();
  if (op?.type !== "endSponsoringFutureReserves" || op.source !== e.account) return "it doesn't end the sponsorship";
  if (i !== ops.length) return "it does more than open your account";
  return null;
}

export interface MandateSeen {
  /** Per period, in Stellar units (7 decimals). */
  capUnits: bigint;
  periodSecs: number;
  endAt: number;
  /** The whole allowance the contract asks the token for, across this owner's mandates (Stellar units). */
  allowanceUnits: bigint;
  validUntilLedger: number;
}

/**
 * The authorization a mandate asks the owner to sign: this network, the pinned contract's create(), for this owner,
 * and inside it only USDC's approve() from this owner to that contract. Returns what it allows, or why it's refused.
 */
export function checkMandatePreimage(
  preimageB64: string,
  payloadHex: string,
  e: { network: StellarNet; account: string; contract: string; usdcContract: string },
): { ok: true; seen: MandateSeen } | { ok: false; reason: string } {
  const no = (reason: string) => ({ ok: false as const, reason });
  let p: xdr.HashIdPreimage;
  try {
    p = xdr.HashIdPreimage.fromXdr(preimageB64, "base64");
  } catch {
    return no("it isn't a Stellar authorization");
  }
  if (sha256hex(p.toXdr()) !== payloadHex.toLowerCase()) return no("it doesn't match what you'd sign");
  const auth = (p as unknown as Record<string, unknown>)[p.type === "envelopeTypeSorobanAuthorizationWithAddress" ? "sorobanAuthorizationWithAddress" : "sorobanAuthorization"] as
    | { networkId: { toXdrObject(): Uint8Array } | Uint8Array; signatureExpirationLedger: number; address?: xdr.ScAddress; invocation: xdr.SorobanAuthorizedInvocation }
    | undefined;
  if (!auth?.invocation) return no("it isn't a contract authorization");
  const netId = auth.networkId instanceof Uint8Array ? auth.networkId : auth.networkId.toXdrObject();
  if (hex(netId) !== sha256hex(utf8(PASSPHRASE[e.network]))) return no("it's for a different network");
  if (auth.address && Address.fromScAddress(auth.address).toString() !== e.account) return no("it's for a different account");

  const call = (inv: xdr.SorobanAuthorizedInvocation) => {
    const f = inv.function as unknown as { type: string; contractFn?: { contractAddress: xdr.ScAddress; functionName: unknown; args: xdr.ScVal[] } };
    if (f.type !== "sorobanAuthorizedFunctionTypeContractFn" || !f.contractFn) return null;
    return { contract: Address.fromScAddress(f.contractFn.contractAddress).toString(), fn: String(f.contractFn.functionName), args: f.contractFn.args.map((a) => scValToNative(a)) };
  };
  const top = call(auth.invocation);
  if (!top || top.contract !== e.contract || top.fn !== "create") return no("it isn't ConstantUnits' mandate contract");
  const [owner, , cap, period, end, expiry] = top.args as [string, Uint8Array, bigint, bigint, bigint, number];
  if (owner !== e.account) return no("the mandate isn't for your account");
  if (typeof cap !== "bigint" || cap <= 0n) return no("the limit isn't valid");

  const subs = auth.invocation.subInvocations;
  if (subs.length !== 1 || subs[0]!.subInvocations.length !== 0) return no("it asks for more than one thing");
  const sub = call(subs[0]!);
  if (!sub || sub.contract !== e.usdcContract || sub.fn !== "approve") return no("it isn't a USDC allowance");
  const [from, spender, amount, until] = sub.args as [string, string, bigint, number];
  if (from !== e.account || spender !== e.contract) return no("the allowance goes to someone else");
  if (Number(until) !== Number(expiry)) return no("the allowance's expiry doesn't match");
  if (!StrKey.isValidContract(e.contract)) return no("the contract isn't valid");
  return {
    ok: true,
    seen: { capUnits: cap, periodSecs: Number(period), endAt: Number(end), allowanceUnits: amount, validUntilLedger: auth.signatureExpirationLedger },
  };
}

/** Circle's USDC issuer on this network, and its Stellar Asset Contract: what the app pins, not what the server says. */
export function pinnedUsdc(network: StellarNet): { issuer: string; contract: string } {
  const u = STELLAR_USDC[network];
  return { issuer: u.issuer, contract: new Asset(u.code, u.issuer).contractId(PASSPHRASE[network]) };
}

/** A wallet's Stellar account as a G… address, whether the wallet gave it that way or as a hex ed25519 key. */
export function toStellarAccount(address: string): string | null {
  if (StrKey.isValidEd25519PublicKey(address)) return address;
  const h = address.replace(/^0x/, "");
  if (/^[0-9a-fA-F]{64}$/.test(h)) return StrKey.encodeEd25519PublicKey(Uint8Array.from(h.match(/../g)!.map((x) => parseInt(x, 16))) as never);
  return null;
}

/** 199_700_000 Stellar units → "19.97". */
export function formatStellarUnits(units: bigint): string {
  const cents = units / 100_000n;
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`;
}
