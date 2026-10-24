/**
 * One interface for every network a bill can be charged on: Base and Arc (Coinbase spend permissions, D-063, D-070)
 * and Stellar (Constant's Soroban mandate contract, D-085). The renewal, charge and permission steps in dollars.ts
 * are written once against it, so every rule (charge before vend, save before send, guards, notices) applies to all.
 */
import { createHash } from "node:crypto";
import { STABLES, permissionFromJson, stableFor, type EvmChain, type PermissionChain, type SpendPermission, type StellarRail } from "@constant/chains";
import type { PermissionRow } from "@constant/db";
import type { Hex } from "viem";

export type RailTxState = "pending" | "confirmed" | "reverted" | "unknown" | "expired";

export interface RailTx {
  hash: string;
  raw: string;
}

/** A token a bill can be charged in, on one network. */
export interface ChargeToken {
  key: string;
  symbol: "USDC" | "USDT";
  chain: string;
  /** Contract address (0x… on EVM, C… on Stellar). */
  address: string;
}

export interface ChargeRail {
  readonly chain: string;
  /** For people: "Base", "Arc", "Stellar". */
  readonly networkName: string;
  /** The token this permission is for, if Constant accepts it on this network. */
  token(p: PermissionRow): ChargeToken | null;
  /** Usable on chain right now: registered and not revoked, by Constant or by the user from their own wallet. */
  isApproved(p: PermissionRow): Promise<boolean>;
  /** Chargeable in the current period, in micro-units. */
  remaining(p: PermissionRow): Promise<bigint>;
  /** What the user's account holds of the permission's token, in micro-units. */
  balance(p: PermissionRow): Promise<bigint>;
  /** True once the user's signature can no longer be registered, so they must sign again. */
  signatureLapsed(p: PermissionRow): Promise<boolean>;
  prepareApprove(p: PermissionRow): Promise<RailTx>;
  /** `orderId` makes the charge idempotent where the network supports it (Stellar's charge id). */
  prepareSpend(p: PermissionRow, value: bigint, orderId: string): Promise<RailTx>;
  prepareRevoke(p: PermissionRow): Promise<RailTx>;
  broadcast(raw: string): Promise<void>;
  /** "expired": provably never included (past its time limit), so it may be built and sent again. */
  status(hash: string, raw: string | null): Promise<RailTxState>;
}

export function rowToPermission(p: PermissionRow): SpendPermission {
  return permissionFromJson({
    account: p.account,
    spender: p.spender,
    token: p.token,
    allowance: p.allowance,
    period: Number(p.period),
    start: Number(p.start_at),
    end: Number(p.end_at),
    salt: p.salt,
    extraData: p.extra_data,
  });
}

/** Base or Arc, through Coinbase's Spend Permission Manager. */
export function evmRail(chain: PermissionChain, confirmations: bigint): ChargeRail {
  return {
    chain: chain.chain,
    networkName: chain.chain === "arc" ? "Arc" : "Base",
    token: (p) => stableFor(chain.chain as EvmChain, p.token),
    isApproved: (p) => chain.isApproved(rowToPermission(p)),
    remaining: (p) => chain.remainingThisPeriod(rowToPermission(p)),
    balance: (p) => chain.balanceOf(p.token as Hex, p.account as Hex),
    // An EVM permission signature stays valid until the permission's own end.
    signatureLapsed: async (p) => Number(p.end_at) * 1000 <= Date.now(),
    prepareApprove: (p) => chain.prepareApprove(rowToPermission(p), p.signature as Hex),
    prepareSpend: (p, value) => chain.prepareSpend(rowToPermission(p), value),
    prepareRevoke: (p) => chain.prepareRevoke(rowToPermission(p)),
    broadcast: (raw) => chain.broadcast(raw as Hex),
    status: (hash) => chain.status(hash as Hex, confirmations),
  };
}

export const STELLAR_USDC_KEY = "stellar-usdc";

/** What a Stellar permission row keeps beyond the common columns (extra_data, JSON). */
export interface StellarPermissionData {
  /** The user's signed authorization entry for create(), base64. */
  entry: string;
  expiryLedger: number;
  /** Last ledger the signed entry can be used in. */
  validUntilLedger: number;
}

/** The mandate id is the permission's salt: 32 bytes, kept as a number in the salt column. */
export const stellarMandateId = (p: Pick<PermissionRow, "salt">) => BigInt(p.salt).toString(16).padStart(64, "0");

/** 32 bytes from the order id: the contract never charges the same one twice (D-085). */
export const stellarChargeId = (orderId: string) => createHash("sha256").update(`constant.charge.v1:${orderId}`).digest("hex");

export function parseStellarData(p: PermissionRow): StellarPermissionData {
  const d = JSON.parse(p.extra_data) as StellarPermissionData;
  if (typeof d.entry !== "string" || !Number.isInteger(d.expiryLedger) || !Number.isInteger(d.validUntilLedger)) throw new Error("malformed Stellar permission");
  return d;
}

/** What the worker needs from a Stellar rail: the real one, or FakeStellarRail in tests. */
export type StellarRailLike = Pick<
  StellarRail,
  "network" | "usdcContract" | "contractId" | "isActive" | "remaining" | "balanceMicro" | "latestLedger" | "prepareCreate" | "prepareCharge" | "prepareRevoke" | "broadcast" | "status" | "maxTimeOf"
>;

/** Stellar, through Constant's mandate contract. The operator pays every fee; the user only ever signed. */
export function stellarRail(rail: StellarRailLike): ChargeRail {
  const usdc = { key: STELLAR_USDC_KEY, symbol: "USDC" as const, chain: "stellar", address: rail.usdcContract };
  return {
    chain: "stellar",
    networkName: "Stellar",
    token: (p) => (p.token === rail.usdcContract && p.spender === rail.contractId ? usdc : null),
    isApproved: (p) => rail.isActive(stellarMandateId(p)),
    remaining: (p) => rail.remaining(stellarMandateId(p)),
    balance: (p) => rail.balanceMicro(p.account),
    signatureLapsed: async (p) => (await rail.latestLedger()) > parseStellarData(p).validUntilLedger,
    prepareApprove: (p) => {
      const data = parseStellarData(p);
      const terms = {
        owner: p.account,
        id: stellarMandateId(p),
        capMicro: BigInt(p.allowance),
        periodSecs: Number(p.period),
        endAt: Number(p.end_at),
        expiryLedger: data.expiryLedger,
      };
      return rail.prepareCreate(terms, data.entry);
    },
    prepareSpend: (p, value, orderId) => rail.prepareCharge(stellarMandateId(p), stellarChargeId(orderId), value),
    prepareRevoke: (p) => rail.prepareRevoke(stellarMandateId(p)),
    broadcast: (raw) => rail.broadcast(raw),
    // Without the envelope (cleared once final) there's no time limit to judge by: never "expired".
    status: (hash, raw) => rail.status(hash, raw ? rail.maxTimeOf(raw) : undefined),
  };
}

/** Tokens in the order the worker tries them: USDC before USDT, Base before Arc before Stellar. */
export function tokenPreference(t: ChargeToken): number {
  const i = STABLES.findIndex((s) => s.key === t.key);
  return i >= 0 ? i : STABLES.length;
}
