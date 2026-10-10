/**
 * Every chain fact Constant relies on, in one place, with where it was checked (RAILS.md "Sources").
 * Re-verify before each mainnet change; a wrong address here loses money.
 *
 * - Base USDC: Circle. Base USDT: the contract Paycrest lists for off-ramp (RAILS "Deposits").
 * - Arc (docs.arc.io, contract-addresses, checked 2026-10-10): chain 5042, USDC ERC-20 interface at
 *   0x3600…0000 with 6 decimals (native gas uses 18), final in under a second, CCTP domain 26.
 * - CCTP domains (developers.circle.com, checked 2026-10-10): Base 6, Arc 26, Stellar 27.
 */
import type { Address } from "viem";

export type EvmChain = "base" | "arc";

export interface EvmChainConfig {
  key: EvmChain;
  chainId: number;
  name: string;
  defaultRpc: string;
  explorer: string;
  /** Blocks to wait before a deposit counts. Arc is final in under a second; Base is an L2 with a sequencer. */
  confirmations: bigint;
  cctpDomain: number;
  /** Largest block range per log query; public RPCs reject more. */
  maxLogRange: bigint;
}

export const EVM_CHAINS: Record<EvmChain, EvmChainConfig> = {
  base: {
    key: "base",
    chainId: 8453,
    name: "Base",
    defaultRpc: "https://mainnet.base.org",
    explorer: "https://basescan.org",
    confirmations: 12n,
    cctpDomain: 6,
    maxLogRange: 2_000n,
  },
  arc: {
    key: "arc",
    chainId: 5042,
    name: "Arc",
    defaultRpc: "https://rpc.mainnet.arc.io",
    explorer: "https://explorer.arc.io",
    confirmations: 0n,
    cctpDomain: 26,
    maxLogRange: 2_000n,
  },
};

export interface StableToken {
  key: "base-usdc" | "base-usdt" | "arc-usdc";
  chain: EvmChain;
  symbol: "USDC" | "USDT";
  address: Address;
  decimals: 6;
}

/** The only tokens Constant accepts (INV-46). Anything else arriving is quarantined. */
export const STABLES: readonly StableToken[] = [
  { key: "base-usdc", chain: "base", symbol: "USDC", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 },
  { key: "base-usdt", chain: "base", symbol: "USDT", address: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2", decimals: 6 },
  { key: "arc-usdc", chain: "arc", symbol: "USDC", address: "0x3600000000000000000000000000000000000000", decimals: 6 },
];

export function stableFor(chain: EvmChain, token: string): StableToken | null {
  const t = token.toLowerCase();
  return STABLES.find((s) => s.chain === chain && s.address.toLowerCase() === t) ?? null;
}

export const CCTP_DOMAIN = { base: 6, arc: 26, stellar: 27 } as const;

/** CCTP V2 contracts share one address on EVM mainnets (Arc docs, contract-addresses). */
export const CCTP_V2 = {
  tokenMessenger: "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d" as Address,
  messageTransmitter: "0x81D40F21F12A8F0E3252Bccb954D722d4c464B64" as Address,
};

export type StellarNetwork = "testnet" | "public";

export const STELLAR = {
  testnet: { horizon: "https://horizon-testnet.stellar.org", passphrase: "Test SDF Network ; September 2015", explorer: "https://stellar.expert/explorer/testnet" },
  public: { horizon: "https://horizon.stellar.org", passphrase: "Public Global Stellar Network ; September 2015", explorer: "https://stellar.expert/explorer/public" },
} as const;

/** 20000000 (6 decimals) → "20.00". Exact; no floats. */
export function formatUnits6(raw: bigint): string {
  const neg = raw < 0n;
  const abs = neg ? -raw : raw;
  const whole = (abs / 1_000_000n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = (abs % 1_000_000n).toString().padStart(6, "0").slice(0, 2);
  return `${neg ? "-" : ""}${whole}.${frac}`;
}
