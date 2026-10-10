/**
 * Coinbase Spend Permissions on Base (D-063). Source checked 2026-10-10: github.com/coinbase/spend-permissions,
 * src/SpendPermissionManager.sol. The user's Coinbase Smart Wallet signs an EIP-712 SpendPermission; the
 * manager, once added as an owner of that wallet, lets only the named spender move at most `allowance` of
 * `token` per `period`. Constant's spender is a server key that holds a little ETH for gas and nothing else.
 */
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  http,
  keccak256,
  parseAbi,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { base } from "viem/chains";
import { EVM_CHAINS } from "./config.js";

export const SPEND_PERMISSION_MANAGER: Address = "0xf85210B21cC50302F477BA56686d2019dC9b67Ad";

export interface SpendPermission {
  account: Address;
  spender: Address;
  token: Address;
  allowance: bigint; // uint160
  period: number; // uint48, seconds
  start: number; // uint48, unix seconds, inclusive
  end: number; // uint48, unix seconds, exclusive
  salt: bigint; // uint256
  extraData: Hex;
}

export const SPEND_PERMISSION_TYPES = {
  SpendPermission: [
    { name: "account", type: "address" },
    { name: "spender", type: "address" },
    { name: "token", type: "address" },
    { name: "allowance", type: "uint160" },
    { name: "period", type: "uint48" },
    { name: "start", type: "uint48" },
    { name: "end", type: "uint48" },
    { name: "salt", type: "uint256" },
    { name: "extraData", type: "bytes" },
  ],
} as const;

export function spendPermissionTypedData(p: SpendPermission, chainId = EVM_CHAINS.base.chainId) {
  return {
    domain: { name: "Spend Permission Manager", version: "1", chainId, verifyingContract: SPEND_PERMISSION_MANAGER },
    types: SPEND_PERMISSION_TYPES,
    primaryType: "SpendPermission" as const,
    message: p,
  };
}

const PERMISSION_TUPLE =
  "(address account, address spender, address token, uint160 allowance, uint48 period, uint48 start, uint48 end, uint256 salt, bytes extraData)";

export const SPEND_PERMISSION_MANAGER_ABI = parseAbi([
  `function approveWithSignature(${PERMISSION_TUPLE} spendPermission, bytes signature) returns (bool)`,
  `function spend(${PERMISSION_TUPLE} spendPermission, uint160 value)`,
  `function revokeAsSpender(${PERMISSION_TUPLE} spendPermission)`,
  `function revoke(${PERMISSION_TUPLE} spendPermission)`,
  `function isApproved(${PERMISSION_TUPLE} spendPermission) view returns (bool)`,
  `function isRevoked(${PERMISSION_TUPLE} spendPermission) view returns (bool)`,
  `function isValid(${PERMISSION_TUPLE} spendPermission) view returns (bool)`,
  `function getCurrentPeriod(${PERMISSION_TUPLE} spendPermission) view returns ((uint48 start, uint48 end, uint160 spend))`,
  `function getHash(${PERMISSION_TUPLE} spendPermission) view returns (bytes32)`,
]);

/** The two Coinbase Smart Wallet functions the app needs to let the manager act. */
export const SMART_WALLET_ABI = parseAbi(["function addOwnerAddress(address owner)", "function isOwnerAddress(address account) view returns (bool)"]);

/** The call the user's wallet makes on itself so the manager can move money within signed limits. */
export const addManagerCall = (account: Address) => ({
  to: account,
  data: encodeFunctionData({ abi: SMART_WALLET_ABI, functionName: "addOwnerAddress", args: [SPEND_PERMISSION_MANAGER] }),
  value: 0n,
});

/** JSON-safe form, for the API and the database. */
export interface SpendPermissionJson {
  account: string;
  spender: string;
  token: string;
  allowance: string;
  period: number;
  start: number;
  end: number;
  salt: string;
  extraData: string;
}

export const permissionToJson = (p: SpendPermission): SpendPermissionJson => ({ ...p, allowance: p.allowance.toString(), salt: p.salt.toString() });

/** Parses and normalises an untrusted permission. Throws on anything malformed. */
export function permissionFromJson(j: unknown): SpendPermission {
  const o = j as Record<string, unknown>;
  const addr = (v: unknown) => {
    if (typeof v !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(v)) throw new Error("bad address");
    return getAddress(v);
  };
  const uint = (v: unknown, max: bigint) => {
    if (typeof v !== "string" || !/^\d{1,78}$/.test(v)) throw new Error("bad integer");
    const n = BigInt(v);
    if (n > max) throw new Error("integer too large");
    return n;
  };
  const u48 = (v: unknown) => {
    if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0 || v >= 2 ** 48) throw new Error("bad uint48");
    return v;
  };
  if (typeof o.extraData !== "string" || !/^0x([0-9a-fA-F]{2})*$/.test(o.extraData)) throw new Error("bad extraData");
  return {
    account: addr(o.account),
    spender: addr(o.spender),
    token: addr(o.token),
    allowance: uint(o.allowance, 2n ** 160n - 1n),
    period: u48(o.period),
    start: u48(o.start),
    end: u48(o.end),
    salt: uint(o.salt, 2n ** 256n - 1n),
    extraData: o.extraData as Hex,
  };
}

export type TxState = "pending" | "confirmed" | "reverted" | "unknown";

/** A transaction signed and hashed before it is sent, so its hash can be saved first (rule 7). */
export interface PreparedTx {
  hash: Hex;
  raw: Hex;
  nonce: number;
}

/** Everything the worker and API need from Base for dollar autopay. */
export interface PermissionChain {
  readonly spender: Address;
  /** True if `signature` is the account's signature over the permission (ERC-1271 and ERC-6492 included). */
  verifySignature(p: SpendPermission, signature: Hex): Promise<boolean>;
  isApproved(p: SpendPermission): Promise<boolean>;
  /** Allowance left in the current period, in token units. */
  remainingThisPeriod(p: SpendPermission): Promise<bigint>;
  balanceOf(token: Address, account: Address): Promise<bigint>;
  prepareApprove(p: SpendPermission, signature: Hex): Promise<PreparedTx>;
  prepareSpend(p: SpendPermission, value: bigint): Promise<PreparedTx>;
  prepareRevoke(p: SpendPermission): Promise<PreparedTx>;
  /** An ERC-20 transfer from the spender itself: the sweep of charged USDC to the treasury. */
  prepareTransfer(token: Address, to: Address, amount: bigint): Promise<PreparedTx>;
  broadcast(raw: Hex): Promise<void>;
  /** Confirmed only after `minConfirmations` blocks on top. */
  status(hash: Hex, minConfirmations: bigint): Promise<TxState>;
}

export class BasePermissionChain implements PermissionChain {
  readonly spender: Address;
  private readonly account: PrivateKeyAccount;
  private readonly client: PublicClient;
  private readonly wallet;

  constructor(spenderKey: Hex, rpcUrl?: string) {
    this.account = privateKeyToAccount(spenderKey);
    this.spender = this.account.address;
    const transport = http(rpcUrl || EVM_CHAINS.base.defaultRpc, { timeout: 20_000, retryCount: 2 });
    this.client = createPublicClient({ chain: base, transport }) as PublicClient;
    this.wallet = createWalletClient({ chain: base, transport, account: this.account });
  }

  verifySignature(p: SpendPermission, signature: Hex): Promise<boolean> {
    // viem checks EOA, ERC-1271 (deployed smart wallet) and ERC-6492 (not yet deployed) signatures.
    const params = { address: p.account, signature, ...spendPermissionTypedData(p) } as unknown as Parameters<PublicClient["verifyTypedData"]>[0];
    return this.client.verifyTypedData(params).catch(() => false);
  }

  isApproved(p: SpendPermission): Promise<boolean> {
    return this.client.readContract({ address: SPEND_PERMISSION_MANAGER, abi: SPEND_PERMISSION_MANAGER_ABI, functionName: "isApproved", args: [p] });
  }

  async remainingThisPeriod(p: SpendPermission): Promise<bigint> {
    const cur = await this.client.readContract({ address: SPEND_PERMISSION_MANAGER, abi: SPEND_PERMISSION_MANAGER_ABI, functionName: "getCurrentPeriod", args: [p] });
    const left = p.allowance - cur.spend;
    return left > 0n ? left : 0n;
  }

  balanceOf(token: Address, account: Address): Promise<bigint> {
    return this.client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [account] });
  }

  private async prepare(data: Hex, to: Address = SPEND_PERMISSION_MANAGER): Promise<PreparedTx> {
    const req = await this.wallet.prepareTransactionRequest({ to, data, account: this.account, chain: base });
    const raw = await this.wallet.signTransaction(req);
    return { hash: keccak256(raw), raw, nonce: req.nonce };
  }

  prepareApprove(p: SpendPermission, signature: Hex) {
    return this.prepare(encodeFunctionData({ abi: SPEND_PERMISSION_MANAGER_ABI, functionName: "approveWithSignature", args: [p, signature] }));
  }

  prepareSpend(p: SpendPermission, value: bigint) {
    return this.prepare(encodeFunctionData({ abi: SPEND_PERMISSION_MANAGER_ABI, functionName: "spend", args: [p, value] }));
  }

  prepareRevoke(p: SpendPermission) {
    return this.prepare(encodeFunctionData({ abi: SPEND_PERMISSION_MANAGER_ABI, functionName: "revokeAsSpender", args: [p] }));
  }

  prepareTransfer(token: Address, to: Address, amount: bigint) {
    return this.prepare(encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, amount] }), token);
  }

  async broadcast(raw: Hex): Promise<void> {
    try {
      await this.client.sendRawTransaction({ serializedTransaction: raw });
    } catch (err) {
      // Re-sending a transaction the network already has is fine; anything else is a real error.
      if (!/already known|nonce too low|already imported/i.test((err as Error).message)) throw err;
    }
  }

  async status(hash: Hex, minConfirmations: bigint): Promise<TxState> {
    try {
      const r = await this.client.getTransactionReceipt({ hash });
      if (r.status === "reverted") return "reverted";
      const head = await this.client.getBlockNumber({ cacheTime: 0 });
      return head - r.blockNumber + 1n >= minConfirmations ? "confirmed" : "pending";
    } catch {
      return "unknown"; // not mined yet, or not seen by this node
    }
  }
}

/** In-memory Base for tests: approvals, period spend, balances, and transactions you can mine or revert. */
export class FakePermissionChain implements PermissionChain {
  readonly spender: Address = "0x5000000000000000000000000000000000000005";
  approved = new Set<string>();
  spent = new Map<string, bigint>();
  balances = new Map<string, bigint>();
  validSignatures = new Set<string>();
  txs = new Map<Hex, { kind: "approve" | "spend" | "revoke" | "transfer"; key: string; value: bigint; state: TxState; broadcast: boolean; to?: string }>();
  /** Next status for each new transaction once broadcast; default confirmed. */
  outcome: TxState = "confirmed";
  /** Simulate the process dying while sending: the next broadcast throws before reaching the network. */
  failBroadcast = 0;
  private n = 0;
  /** Distinct per instance, so hashes never collide across tests sharing a database. */
  private readonly prefix = Math.floor(Math.random() * 2 ** 32).toString(16).padStart(8, "0");

  key = (p: SpendPermission) => `${p.account}:${p.salt}`;
  async verifySignature(p: SpendPermission, sig: Hex) {
    return this.validSignatures.has(`${this.key(p)}:${sig}`);
  }
  async isApproved(p: SpendPermission) {
    return this.approved.has(this.key(p));
  }
  async remainingThisPeriod(p: SpendPermission) {
    const left = p.allowance - (this.spent.get(this.key(p)) ?? 0n);
    return left > 0n ? left : 0n;
  }
  async balanceOf(_token: Address, account: Address) {
    return this.balances.get(account.toLowerCase()) ?? 0n;
  }
  async prepareTransfer(_token: Address, to: Address, amount: bigint) {
    const prepared = this.tx("transfer", null, amount);
    this.txs.get(prepared.hash)!.to = to.toLowerCase();
    return prepared;
  }
  private tx(kind: "approve" | "spend" | "revoke" | "transfer", p: SpendPermission | null, value = 0n): PreparedTx {
    this.n += 1;
    const hash = `0x${this.prefix}${this.n.toString(16).padStart(56, "0")}` as Hex;
    this.txs.set(hash, { kind, key: p ? this.key(p) : "", value, state: "unknown", broadcast: false });
    return { hash, raw: hash, nonce: this.n };
  }
  async prepareApprove(p: SpendPermission) {
    return this.tx("approve", p);
  }
  async prepareSpend(p: SpendPermission, value: bigint) {
    return this.tx("spend", p, value);
  }
  async prepareRevoke(p: SpendPermission) {
    return this.tx("revoke", p);
  }
  async broadcast(raw: Hex) {
    if (this.failBroadcast > 0) {
      this.failBroadcast -= 1;
      throw new Error("connection lost");
    }
    const t = this.txs.get(raw);
    if (!t || t.broadcast) return;
    t.broadcast = true;
    t.state = this.outcome;
    if (t.state !== "confirmed") return;
    this.apply(t);
  }
  /** Settle a transaction left pending. */
  mine(hash: Hex, state: "confirmed" | "reverted") {
    const t = this.txs.get(hash)!;
    t.state = state;
    if (state === "confirmed") this.apply(t);
  }
  private apply(t: { kind: string; key: string; value: bigint; to?: string }) {
    if (t.kind === "transfer") {
      const from = this.spender.toLowerCase();
      this.balances.set(from, (this.balances.get(from) ?? 0n) - t.value);
      this.balances.set(t.to!, (this.balances.get(t.to!) ?? 0n) + t.value);
      return;
    }
    if (t.kind === "approve") this.approved.add(t.key);
    if (t.kind === "revoke") this.approved.delete(t.key);
    if (t.kind === "spend") {
      this.spent.set(t.key, (this.spent.get(t.key) ?? 0n) + t.value);
      const account = t.key.split(":")[0]!.toLowerCase();
      this.balances.set(account, (this.balances.get(account) ?? 0n) - t.value);
      const sp = this.spender.toLowerCase();
      this.balances.set(sp, (this.balances.get(sp) ?? 0n) + t.value);
    }
  }
  async status(hash: Hex) {
    return this.txs.get(hash)?.state ?? "unknown";
  }
}

/**
 * Read-only: what the API needs. It knows the spender's address but never holds its key (least privilege);
 * only the worker can move money.
 */
export class BasePermissionVerifier implements Pick<PermissionChain, "spender" | "verifySignature"> {
  private readonly client: PublicClient;
  constructor(
    readonly spender: Address,
    rpcUrl?: string,
  ) {
    this.client = createPublicClient({ chain: base, transport: http(rpcUrl || EVM_CHAINS.base.defaultRpc, { timeout: 20_000, retryCount: 2 }) }) as PublicClient;
  }
  verifySignature(p: SpendPermission, signature: Hex): Promise<boolean> {
    const params = { address: p.account, signature, ...spendPermissionTypedData(p) } as unknown as Parameters<PublicClient["verifyTypedData"]>[0];
    return this.client.verifyTypedData(params).catch(() => false);
  }
}
