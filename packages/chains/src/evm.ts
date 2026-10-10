/**
 * Reading ERC-20 transfers into users' own addresses on Base and Arc. Read-only: nothing here signs.
 */
import { createPublicClient, getAddress, http, parseAbiItem, type Address, type PublicClient } from "viem";
import { EVM_CHAINS, type EvmChain } from "./config.js";

export interface TransferLog {
  chain: EvmChain;
  token: Address;
  from: Address;
  to: Address;
  value: bigint;
  txHash: `0x${string}`;
  logIndex: number;
  blockNumber: bigint;
}

/** What the deposit indexer needs from a chain. */
export interface EvmReader {
  readonly chain: EvmChain;
  head(): Promise<bigint>;
  /**
   * ERC-20 Transfers to any of `to` in [fromBlock, toBlock]. With `tokens`, only from those contracts
   * (works on public RPCs); without, from any contract (needs an RPC that allows unfiltered log queries).
   */
  transfersTo(to: readonly Address[], fromBlock: bigint, toBlock: bigint, tokens?: readonly Address[]): Promise<TransferLog[]>;
}

const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");

/** RPCs cap the number of topic values per query; keep each query's address list small. */
const ADDRESSES_PER_QUERY = 200;

export class ViemReader implements EvmReader {
  private readonly client: PublicClient;

  constructor(
    readonly chain: EvmChain,
    rpcUrl?: string,
  ) {
    const c = EVM_CHAINS[chain];
    this.client = createPublicClient({ transport: http(rpcUrl || c.defaultRpc, { timeout: 20_000, retryCount: 2 }) }) as PublicClient;
  }

  head(): Promise<bigint> {
    return this.client.getBlockNumber({ cacheTime: 0 });
  }

  async transfersTo(to: readonly Address[], fromBlock: bigint, toBlock: bigint, tokens?: readonly Address[]): Promise<TransferLog[]> {
    const out: TransferLog[] = [];
    for (let i = 0; i < to.length; i += ADDRESSES_PER_QUERY) {
      const logs = await this.client.getLogs({
        ...(tokens ? { address: [...tokens] } : {}),
        event: TRANSFER,
        args: { to: to.slice(i, i + ADDRESSES_PER_QUERY) as Address[] },
        fromBlock,
        toBlock,
        strict: true,
      });
      for (const l of logs) {
        if (l.removed || l.transactionHash === null || l.logIndex === null || l.blockNumber === null) continue;
        out.push({
          chain: this.chain,
          token: getAddress(l.address),
          from: getAddress(l.args.from),
          to: getAddress(l.args.to),
          value: l.args.value,
          txHash: l.transactionHash,
          logIndex: l.logIndex,
          blockNumber: l.blockNumber,
        });
      }
    }
    return out;
  }
}

/** Tests and local dev: a chain you can append blocks and transfers to. */
export class FakeReader implements EvmReader {
  height = 1_000n;
  logs: TransferLog[] = [];
  calls: { from: bigint; to: bigint }[] = [];
  constructor(readonly chain: EvmChain) {}
  async head() {
    return this.height;
  }
  async transfersTo(to: readonly Address[], fromBlock: bigint, toBlock: bigint, tokens?: readonly Address[]) {
    this.calls.push({ from: fromBlock, to: toBlock });
    const set = new Set(to.map((a) => a.toLowerCase()));
    const only = tokens ? new Set(tokens.map((a) => a.toLowerCase())) : null;
    return this.logs.filter((l) => set.has(l.to.toLowerCase()) && l.blockNumber >= fromBlock && l.blockNumber <= toBlock && (!only || only.has(l.token.toLowerCase())));
  }
}

/** A checksummed EVM address, or null. */
export function evmAddress(v: unknown): Address | null {
  if (typeof v !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(v)) return null;
  try {
    return getAddress(v);
  } catch {
    return null;
  }
}
