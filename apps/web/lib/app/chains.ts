import { createPublicClient, defineChain, erc20Abi, http, type Address } from "viem";
import { base } from "viem/chains";

/** Arc mainnet, from docs.arc.io (connect-to-arc, contract-addresses). USDC is the gas token. */
export const arc = defineChain({
  id: 5042,
  name: "Arc",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [process.env.NEXT_PUBLIC_ARC_RPC_URL ?? "https://rpc.mainnet.arc.io"] } },
  blockExplorers: { default: { name: "Arc Explorer", url: "https://explorer.arc.io" } },
});

export { base };

export type StableToken = {
  key: string;
  symbol: "USDC" | "USDT";
  chain: "base" | "arc";
  address: Address;
  decimals: number;
};

/**
 * The only tokens ConstantUnits accepts (RAILS.md, INV-46). USDT is Base only: there is no USDT on Arc.
 * Base USDT is the contract Paycrest lists for off-ramp.
 */
export const STABLES: StableToken[] = [
  { key: "base-usdc", symbol: "USDC", chain: "base", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 },
  { key: "base-usdt", symbol: "USDT", chain: "base", address: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2", decimals: 6 },
  { key: "arc-usdc", symbol: "USDC", chain: "arc", address: "0x3600000000000000000000000000000000000000", decimals: 6 },
];

export const EXPLORER = {
  base: (a: string) => `https://basescan.org/address/${a}`,
  arc: (a: string) => `https://explorer.arc.io/address/${a}`,
};

const clients = {
  base: createPublicClient({ chain: base, transport: http(process.env.NEXT_PUBLIC_BASE_RPC_URL) }),
  arc: createPublicClient({ chain: arc, transport: http() }),
};

/** Each accepted token's balance at `address`, by key; null where the network didn't answer. */
export async function readStableBalances(address: Address): Promise<Record<string, bigint | null>> {
  const results = await Promise.allSettled(
    STABLES.map((t) => clients[t.chain].readContract({ address: t.address, abi: erc20Abi, functionName: "balanceOf", args: [address] })),
  );
  const out: Record<string, bigint | null> = {};
  STABLES.forEach((t, i) => {
    const r = results[i];
    out[t.key] = r && r.status === "fulfilled" ? (r.value as bigint) : null;
  });
  return out;
}
