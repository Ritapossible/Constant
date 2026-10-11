/**
 * Moving Constant's own charged USDC from Arc to Base with Circle's CCTP V2 (D-070), so it can be off-ramped
 * (Paycrest doesn't list Arc). Never user money: only the spender's balance, to the spender's own address on Base.
 *
 * Checked 2026-10-11: TokenMessengerV2.depositForBurn(amount, destinationDomain, mintRecipient, burnToken,
 * destinationCaller, maxFee, minFinalityThreshold) and MessageTransmitterV2.receiveMessage(message, attestation)
 * (github.com/circlefin/evm-cctp-contracts, src/v2); same addresses on Arc and Base mainnet (Arc docs, contract
 * addresses). Arc burns from the USDC ERC-20 interface 0x3600…0000. Attestations: GET {iris}/v2/messages/{domain}
 * ?transactionHash= → {messages:[{status:"complete", message, attestation}]}; fees: GET {iris}/v2/burn/USDC/fees/26/6
 * → [{finalityThreshold, minimumFee (bps)}], 0 for Arc → Base both ways on 2026-10-11.
 */
import { createPublicClient, createWalletClient, encodeFunctionData, erc20Abi, http, keccak256, pad, parseAbi, type Address, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { BASE_SEPOLIA_USDC, CCTP_DOMAIN, CCTP_V2, CCTP_V2_TESTNET, STABLES, viemChain, type EvmChain } from "./config.js";
import type { PreparedTx, TxState } from "./permissions.js";

/** Standard transfer: wait for finality on the source chain (Arc is final in under a second anyway). */
export const STANDARD_FINALITY = 2000;

const TOKEN_MESSENGER_ABI = parseAbi([
  "function depositForBurn(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold)",
]);
const MESSAGE_TRANSMITTER_ABI = parseAbi(["function receiveMessage(bytes message, bytes attestation) returns (bool)"]);

export type Attestation = { status: "pending" } | { status: "complete"; message: Hex; attestation: Hex };

export interface Bridge {
  readonly from: EvmChain;
  readonly to: EvmChain;
  /** Constant's address on both chains (the spender). */
  readonly spender: Address;
  balance(): Promise<bigint>;
  /** Circle's fee for this amount in micro-USDC, from the fee API (bps × amount, rounded up). */
  fee(amountMicro: bigint): Promise<bigint>;
  /** Two transactions signed together, nonces n and n+1: approve exactly `amount`, then burn it. Saved, then sent in order. */
  prepareBurn(amountMicro: bigint, maxFeeMicro: bigint): Promise<{ approve: PreparedTx; burn: PreparedTx }>;
  attestation(burnHash: Hex): Promise<Attestation>;
  prepareMint(message: Hex, attestation: Hex): Promise<PreparedTx>;
  broadcast(on: EvmChain, raw: Hex): Promise<void>;
  status(on: EvmChain, hash: Hex, minConfirmations: bigint): Promise<TxState>;
}

type Fetch = typeof fetch;

export class CctpBridge implements Bridge {
  readonly spender: Address;
  private readonly account: PrivateKeyAccount;
  private readonly clients: Record<"from" | "to", { chain: ReturnType<typeof viemChain>; pub: PublicClient; wallet: ReturnType<typeof createWalletClient> }>;
  private readonly usdc: Address;
  private readonly contracts: { tokenMessenger: Address; messageTransmitter: Address };
  private readonly iris: string;
  private readonly testnet: boolean;

  constructor(
    readonly from: EvmChain,
    readonly to: EvmChain,
    spenderKey: Hex,
    rpc: Partial<Record<EvmChain, string | undefined>>,
    opts: { testnet?: boolean; iris?: string; fetch?: Fetch } = {},
  ) {
    this.account = privateKeyToAccount(spenderKey);
    this.spender = this.account.address;
    this.testnet = opts.testnet ?? false;
    this.iris = opts.iris ?? (this.testnet ? "https://iris-api-sandbox.circle.com" : "https://iris-api.circle.com");
    this.f = opts.fetch ?? fetch;
    this.contracts = this.testnet ? CCTP_V2_TESTNET : CCTP_V2;
    const make = (c: EvmChain) => {
      const chain = viemChain(c, rpc[c], this.testnet);
      const transport = http(chain.rpcUrls.default.http[0], { timeout: 20_000, retryCount: 2 });
      return { chain, pub: createPublicClient({ chain, transport }) as PublicClient, wallet: createWalletClient({ chain, transport, account: this.account }) };
    };
    this.clients = { from: make(from), to: make(to) };
    this.usdc = this.testnet && from === "base" ? BASE_SEPOLIA_USDC : STABLES.find((s) => s.chain === from && s.symbol === "USDC")!.address;
  }
  private readonly f: Fetch;

  private side(c: EvmChain) {
    if (c === this.from) return this.clients.from;
    if (c === this.to) return this.clients.to;
    throw new Error(`bridge has no ${c} side`);
  }

  balance(): Promise<bigint> {
    return this.clients.from.pub.readContract({ address: this.usdc, abi: erc20Abi, functionName: "balanceOf", args: [this.spender] });
  }

  async fee(amountMicro: bigint): Promise<bigint> {
    const res = await this.f(`${this.iris}/v2/burn/USDC/fees/${CCTP_DOMAIN[this.from]}/${CCTP_DOMAIN[this.to]}`);
    if (!res.ok) throw new Error(`cctp fees unavailable (${res.status})`);
    const rows = (await res.json()) as { finalityThreshold?: number; minimumFee?: number }[];
    const row = rows.find((r) => r.finalityThreshold === STANDARD_FINALITY);
    if (!row || typeof row.minimumFee !== "number" || row.minimumFee < 0) throw new Error("cctp fees: no standard-transfer fee");
    // minimumFee is in basis points; may be fractional. Work in millionths of a bp to stay exact enough.
    const perMillionBp = BigInt(Math.ceil(row.minimumFee * 1_000_000));
    return (amountMicro * perMillionBp + 10_000n * 1_000_000n - 1n) / (10_000n * 1_000_000n);
  }

  async prepareBurn(amountMicro: bigint, maxFeeMicro: bigint) {
    const { pub, wallet, chain } = this.clients.from;
    const nonce = await pub.getTransactionCount({ address: this.spender, blockTag: "pending" });
    const sign = async (to: Address, data: Hex, n: number): Promise<PreparedTx> => {
      const req = await wallet.prepareTransactionRequest({ to, data, account: this.account, chain, nonce: n, gas: 300_000n });
      const raw = await wallet.signTransaction(req as never);
      return { hash: keccak256(raw), raw, nonce: n };
    };
    const approve = await sign(this.usdc, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [this.contracts.tokenMessenger, amountMicro] }), nonce);
    const burn = await sign(
      this.contracts.tokenMessenger,
      encodeFunctionData({
        abi: TOKEN_MESSENGER_ABI,
        functionName: "depositForBurn",
        // Minted to Constant's own spender on the other chain; anyone may relay it (no destination caller).
        args: [amountMicro, CCTP_DOMAIN[this.to], pad(this.spender, { size: 32 }), this.usdc, pad("0x00", { size: 32 }), maxFeeMicro, STANDARD_FINALITY],
      }),
      nonce + 1,
    );
    return { approve, burn };
  }

  async attestation(burnHash: Hex): Promise<Attestation> {
    const res = await this.f(`${this.iris}/v2/messages/${CCTP_DOMAIN[this.from]}?transactionHash=${burnHash}`);
    if (res.status === 404) return { status: "pending" }; // not indexed yet
    if (!res.ok) throw new Error(`cctp attestation lookup failed (${res.status})`);
    const m = ((await res.json()) as { messages?: { status?: string; message?: string; attestation?: string }[] }).messages?.[0];
    if (m?.status === "complete" && m.message?.startsWith("0x") && m.attestation?.startsWith("0x")) return { status: "complete", message: m.message as Hex, attestation: m.attestation as Hex };
    return { status: "pending" };
  }

  async prepareMint(message: Hex, attestation: Hex): Promise<PreparedTx> {
    const { wallet, chain } = this.clients.to;
    const req = await wallet.prepareTransactionRequest({
      to: this.contracts.messageTransmitter,
      data: encodeFunctionData({ abi: MESSAGE_TRANSMITTER_ABI, functionName: "receiveMessage", args: [message, attestation] }),
      account: this.account,
      chain,
    });
    const raw = await wallet.signTransaction(req as never);
    return { hash: keccak256(raw), raw, nonce: req.nonce };
  }

  async broadcast(on: EvmChain, raw: Hex): Promise<void> {
    try {
      await this.side(on).pub.sendRawTransaction({ serializedTransaction: raw });
    } catch (err) {
      if (!/already known|nonce too low|already imported/i.test((err as Error).message)) throw err;
    }
  }

  async status(on: EvmChain, hash: Hex, minConfirmations: bigint): Promise<TxState> {
    const pub = this.side(on).pub;
    try {
      const r = await pub.getTransactionReceipt({ hash });
      if (r.status === "reverted") return "reverted";
      const head = await pub.getBlockNumber({ cacheTime: 0 });
      return head - r.blockNumber + 1n >= minConfirmations ? "confirmed" : "pending";
    } catch {
      return "unknown";
    }
  }
}

/** In-memory bridge for tests. */
export class FakeBridge implements Bridge {
  readonly from: EvmChain = "arc";
  readonly to: EvmChain = "base";
  readonly spender: Address = "0x5000000000000000000000000000000000000005";
  arcBalance = 0n;
  baseMinted = 0n;
  feeBps = 0;
  txs = new Map<Hex, { kind: "approve" | "burn" | "mint"; amount: bigint; state: TxState }>();
  attested = new Set<Hex>();
  outcome: TxState = "confirmed";
  private n = 0;
  private readonly prefix = Math.floor(Math.random() * 2 ** 32).toString(16).padStart(8, "0");
  private tx(kind: "approve" | "burn" | "mint", amount: bigint): PreparedTx {
    this.n += 1;
    const hash = `0x${this.prefix}${this.n.toString(16).padStart(56, "0")}` as Hex;
    this.txs.set(hash, { kind, amount, state: "unknown" });
    return { hash, raw: hash, nonce: this.n };
  }
  async balance() {
    return this.arcBalance;
  }
  async fee(amount: bigint) {
    return (amount * BigInt(this.feeBps) + 9_999n) / 10_000n;
  }
  async prepareBurn(amount: bigint) {
    return { approve: this.tx("approve", amount), burn: this.tx("burn", amount) };
  }
  async attestation(burnHash: Hex): Promise<Attestation> {
    return this.attested.has(burnHash) ? { status: "complete", message: burnHash, attestation: "0xa77e57" } : { status: "pending" };
  }
  async prepareMint(message: Hex) {
    return this.tx("mint", this.txs.get(message)?.amount ?? 0n);
  }
  async broadcast(_on: EvmChain, raw: Hex) {
    const t = this.txs.get(raw);
    if (!t || t.state !== "unknown") return;
    t.state = this.outcome;
    if (t.state !== "confirmed") return;
    if (t.kind === "burn") this.arcBalance -= t.amount;
    if (t.kind === "mint") this.baseMinted += t.amount;
  }
  async status(_on: EvmChain, hash: Hex) {
    return this.txs.get(hash)?.state ?? "unknown";
  }
}
