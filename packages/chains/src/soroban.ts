/**
 * Paying bills from USDC on Stellar (D-085), through Constant's Soroban mandate contract (contracts/mandate).
 *
 * The user's only action is a signature; Constant's operator account is the source of every transaction and pays every
 * fee and reserve, so the user never holds XLM:
 *
 *   onboarding   Constant sponsors the user's account and USDC trustline. The user signs the transaction hash.
 *   mandate      create(owner, id, cap, period, end). The user signs one authorization entry (which also covers the
 *                token allowance); Constant submits it.
 *   charge       charge(id, charge_id, amount) by the operator. The contract enforces the cap per period and never
 *                takes the same charge_id twice; the USDC goes straight to the treasury.
 *   revoke       revoke(caller, id) by the operator (when the user stops in the app) or by the user's own wallet.
 *
 * Every write follows rule 7: prepared and signed here, its hash saved by the caller, then sent. A Stellar transaction
 * carries a time limit, so one that isn't on the ledger once that limit has passed never will be ("expired"), and
 * the caller can safely build it again; the contract's charge_id makes even a double send harmless.
 */
import {
  Account,
  Address,
  Asset,
  BASE_FEE,
  Keypair,
  Operation,
  StrKey,
  TransactionBuilder,
  authorizeEntry,
  buildAuthorizationEntryPreimage,
  hash,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
  type FeeBumpTransaction,
  type Transaction,
} from "@stellar/stellar-sdk";
import { STELLAR, STELLAR_USDC, type StellarNetwork } from "./config.js";

export type StellarTxState = "pending" | "confirmed" | "reverted" | "expired";

/** A signed transaction, hashed before it is sent (rule 7). */
export interface StellarPreparedTx {
  hash: string;
  /** Base64 envelope. */
  raw: string;
  /** Unix seconds after which the network will never include it. */
  maxTime: number;
}

/** How long a mandate's token allowance lasts: 120 days of ledgers, well inside the network's entry lifetime limit. */
export const ALLOWANCE_LEDGERS = 120 * 17_280;
/** A mandate may run at most this long (seconds); the app asks the user to renew it before it ends. */
export const MAX_MANDATE_SECS = 115 * 86_400;

export interface MandateTerms {
  /** The user's G… account. */
  owner: string;
  /** 32 bytes, hex: the permission id. */
  id: string;
  /** Most per period, in micro-USDC (6 decimals, as Constant's books keep it). */
  capMicro: bigint;
  periodSecs: number;
  /** Unix seconds; no charge at or after this. */
  endAt: number;
  /** Ledger the token allowance expires at; set by draftMandate. */
  expiryLedger?: number;
}

/** What the user signs to create a mandate, and what Constant keeps until they do. */
export interface MandateDraft {
  terms: MandateTerms;
  /** The unsigned authorization entry from simulation, base64. */
  entry: string;
  validUntilLedger: number;
  /** sha256 of the authorization preimage, hex: the user signs exactly these 32 bytes with their ed25519 key. */
  payload: string;
  /** The authorization preimage itself, base64: what wallets' signAuthEntry takes. */
  preimage: string;
}

export interface OnChainMandate {
  owner: string;
  capMicro: bigint;
  periodSecs: number;
  start: number;
  end: number;
  spentMicro: bigint;
  periodIndex: number;
  revoked: boolean;
}

export interface OnboardingTx {
  /** Base64 envelope, signed by nobody yet. */
  xdr: string;
  /** Transaction hash, hex: the user signs these 32 bytes. */
  hash: string;
}

/** 1 micro-USDC = 10 Stellar units (7 decimals). */
export const toStellarUnits = (micro: bigint) => micro * 10n;
/** Rounds down: Constant never reports more than is there. */
export const fromStellarUnits = (units: bigint) => units / 10n;

/** The signing address of an authorization entry, whichever credential version simulation used. */
function credentialAddress(c: xdr.SorobanCredentials): string | null {
  if (c.type === "sorobanCredentialsAddress") return Address.fromScAddress(c.address.address).toString();
  if (c.type === "sorobanCredentialsAddressV2") return Address.fromScAddress(c.addressV2.address).toString();
  return null;
}

const toHex = (b: Uint8Array) => Buffer.from(b).toString("hex");

const hex32 = (h: string) => {
  if (!/^[0-9a-f]{64}$/i.test(h)) throw new Error("expected 32 bytes of hex");
  return Buffer.from(h, "hex");
};

/**
 * What a wallet signs for a message (SEP-53, "Sign and Verify Messages"): sha256 of a fixed prefix and the message.
 * Used to prove a Stellar account belongs to the person linking it.
 */
export function stellarMessageHash(message: string): string {
  return toHex(hash(Buffer.from(`Stellar Signed Message:\n${message}`, "utf8")));
}

/** A 64-byte signature from hex (128 characters) or base64, as wallets return it; null if neither. */
export function parseStellarSignature(v: unknown): string | null {
  if (typeof v !== "string") return null;
  if (/^[0-9a-fA-F]{128}$/.test(v)) return v.toLowerCase();
  if (/^[A-Za-z0-9+/]{86}==$/.test(v)) return Buffer.from(v, "base64").toString("hex");
  return null;
}

/** Verifies an ed25519 signature by a G… account over 32 bytes. */
export function verifyStellarSignature(account: string, payloadHex: string, signatureHex: string): boolean {
  try {
    const sig = Buffer.from(signatureHex, "hex");
    return sig.length === 64 && Keypair.fromPublicKey(account).verify(hex32(payloadHex), sig);
  } catch {
    return false;
  }
}

export function isStellarAccount(s: string): boolean {
  try {
    Keypair.fromPublicKey(s);
    return true;
  } catch {
    return false;
  }
}

export interface StellarRailOptions {
  network: StellarNetwork;
  /** Required on the public network (SDF runs none there). */
  rpcUrl?: string;
  /** The mandate contract (C…). */
  contractId: string;
  /** The operator: the contract's admin, source and fee payer of every transaction, sponsor of user reserves. */
  operatorSecret: string;
  /** Classic USDC; defaults to Circle's on the network. */
  usdc?: { code: string; issuer: string };
  /** Inclusion fee per operation, in stroops. */
  baseFee?: string;
  /** Seconds a prepared transaction stays valid. */
  timeoutSecs?: number;
}

export class StellarRail {
  readonly network: StellarNetwork;
  readonly passphrase: string;
  readonly contractId: string;
  readonly operator: Keypair;
  readonly usdc: Asset;
  readonly server: rpc.Server;
  private readonly baseFee: string;
  private readonly timeoutSecs: number;
  /** Next sequence number to use, so several transactions can be in flight; resynced from the ledger on any doubt. */
  private nextSeq: bigint | null = null;

  constructor(o: StellarRailOptions) {
    this.network = o.network;
    this.passphrase = STELLAR[o.network].passphrase;
    const url = o.rpcUrl ?? STELLAR[o.network].rpc;
    if (!url) throw new Error("STELLAR_RPC_URL is required on the public network");
    this.server = new rpc.Server(url, { allowHttp: url.startsWith("http://") });
    this.contractId = o.contractId;
    this.operator = Keypair.fromSecret(o.operatorSecret);
    const u = o.usdc ?? STELLAR_USDC[o.network];
    this.usdc = new Asset(u.code, u.issuer);
    this.baseFee = o.baseFee ?? "1000";
    this.timeoutSecs = o.timeoutSecs ?? 300;
  }

  get operatorAccount(): string {
    return this.operator.publicKey();
  }

  /** The Stellar Asset Contract that wraps classic USDC. */
  get usdcContract(): string {
    return this.usdc.contractId(this.passphrase);
  }

  txUrl(txHash: string): string {
    return `${STELLAR[this.network].explorer}/tx/${txHash}`;
  }

  contractUrl(id = this.contractId): string {
    return `${STELLAR[this.network].explorer}/contract/${id}`;
  }

  // ── Accounts ─────────────────────────────────────────────────────────────────

  /** Whether the user's account exists, can hold USDC, and how much it holds (micro). */
  async accountState(owner: string): Promise<{ exists: boolean; trustline: boolean; usdcMicro: bigint; xlmStroops: bigint }> {
    const accountKey = xdr.LedgerKey.account(new xdr.LedgerKeyAccount({ accountId: Keypair.fromPublicKey(owner).xdrAccountId() }));
    const lineKey = xdr.LedgerKey.trustline(
      new xdr.LedgerKeyTrustLine({ accountId: Keypair.fromPublicKey(owner).xdrAccountId(), asset: this.usdc.toTrustLineXDRObject() }),
    );
    const res = await this.server.getLedgerEntries(accountKey, lineKey);
    let exists = false;
    let trustline = false;
    let usdcMicro = 0n;
    let xlmStroops = 0n;
    for (const e of res.entries) {
      const data = e.val;
      if (data.type === "account") {
        exists = true;
        xlmStroops = BigInt(data.account.balance);
      } else if (data.type === "trustline") {
        trustline = true;
        usdcMicro = fromStellarUnits(BigInt(data.trustLine.balance));
      }
    }
    return { exists, trustline, usdcMicro, xlmStroops };
  }

  /**
   * The transaction that makes `owner` ready to hold USDC, every reserve sponsored by Constant: creates the account
   * if it doesn't exist (with no XLM of its own) and adds the USDC trustline. Null if there's nothing to do.
   */
  async prepareOnboarding(owner: string): Promise<OnboardingTx | null> {
    const st = await this.accountState(owner);
    if (st.exists && st.trustline) return null;
    const source = await this.server.getAccount(this.operatorAccount);
    const b = new TransactionBuilder(source, { fee: this.baseFee, networkPassphrase: this.passphrase })
      .addOperation(Operation.beginSponsoringFutureReserves({ sponsoredId: owner }));
    if (!st.exists) b.addOperation(Operation.createAccount({ destination: owner, startingBalance: "0" }));
    const tx = b
      .addOperation(Operation.changeTrust({ asset: this.usdc, source: owner }))
      .addOperation(Operation.endSponsoringFutureReserves({ source: owner }))
      .setTimeout(this.timeoutSecs)
      .build();
    return { xdr: tx.toXdr(), hash: toHex(tx.hash()) };
  }

  /** Adds the user's signature over the onboarding hash, signs as the operator and sends it; waits for the ledger. */
  async submitOnboarding(owner: string, onboarding: OnboardingTx, signatureHex: string): Promise<string> {
    const tx = TransactionBuilder.fromXDR(onboarding.xdr, this.passphrase) as Transaction;
    if (toHex(tx.hash()) !== onboarding.hash) throw new Error("onboarding transaction doesn't match its hash");
    if (tx.source !== this.operatorAccount) throw new Error("onboarding transaction isn't Constant's");
    if (!verifyStellarSignature(owner, onboarding.hash, signatureHex)) throw new Error("signature doesn't match the account");
    tx.addSignature(owner, Buffer.from(signatureHex, "hex").toString("base64"));
    tx.sign(this.operator);
    const prepared = { hash: onboarding.hash, raw: tx.toXdr(), maxTime: Number(tx.timeBounds?.maxTime ?? 0) };
    await this.broadcast(prepared.raw);
    const st = await this.waitFor(prepared);
    if (st !== "confirmed") throw new Error(`onboarding ${st}`);
    return prepared.hash;
  }

  /** The user's signature (hex) inside a transaction their wallet signed, checked against the expected hash. */
  signatureIn(signedXdr: string, account: string, expectedHash: string): string | null {
    let tx;
    try {
      tx = TransactionBuilder.fromXDR(signedXdr, this.passphrase) as Transaction;
    } catch {
      return null;
    }
    if (toHex(tx.hash()) !== expectedHash) return null;
    for (const sig of tx.signatures) {
      const hex = Buffer.from(sig.signature.toXdrObject()).toString("hex");
      if (verifyStellarSignature(account, expectedHash, hex)) return hex;
    }
    return null;
  }

  // ── Mandates ─────────────────────────────────────────────────────────────────

  /** Simulates create() and returns the 32 bytes the user must sign. Nothing is sent. */
  async draftMandate(terms: MandateTerms, validForLedgers = 1_440): Promise<MandateDraft> {
    if (terms.capMicro <= 0n) throw new Error("cap must be positive");
    if (terms.endAt - Math.floor(Date.now() / 1000) > MAX_MANDATE_SECS) throw new Error("a mandate may run at most 115 days");
    const latest = (await this.server.getLatestLedger()).sequence;
    const t = { ...terms, expiryLedger: latest + ALLOWANCE_LEDGERS };
    const sim = await this.simulate(this.invoke("create", createArgs(t)));
    // Address credentials of any version (protocol 29 simulates V2): the entry the owner must sign.
    const entry = (sim.result?.auth ?? []).find((e) => credentialAddress(e.credentials) === t.owner);
    if (!entry) throw new Error(`simulation asked for no signature from the owner (${(sim.result?.auth ?? []).map((e) => e.credentials.type).join(", ") || "none"})`);
    const validUntilLedger = latest + validForLedgers;
    const preimage = buildAuthorizationEntryPreimage(entry, validUntilLedger, this.passphrase);
    return { terms: t, entry: entry.toXdr("base64"), validUntilLedger, payload: toHex(hash(Buffer.from(preimage.toXdr()))), preimage: preimage.toXdr("base64") };
  }

  /** The draft's authorization entry with the user's signature, base64; refuses a signature that isn't theirs. */
  async signDraft(draft: MandateDraft, signatureHex: string): Promise<string> {
    if (!verifyStellarSignature(draft.terms.owner, draft.payload, signatureHex)) throw new Error("signature doesn't match the account");
    const entry = xdr.SorobanAuthorizationEntry.fromXDR(draft.entry, "base64");
    const signed = await authorizeEntry(
      entry,
      async () => ({ signature: Buffer.from(signatureHex, "hex"), publicKey: draft.terms.owner }),
      draft.validUntilLedger,
      this.passphrase,
    );
    return signed.toXdr("base64");
  }

  /** The create() transaction carrying the user's signed entry, ready to save and send. */
  async prepareCreate(t: MandateTerms, signedEntry: string): Promise<StellarPreparedTx> {
    if (t.expiryLedger === undefined) throw new Error("terms come from draftMandate");
    return this.prepareWrite(this.invoke("create", createArgs(t), [xdr.SorobanAuthorizationEntry.fromXDR(signedEntry, "base64")]));
  }

  /** Takes `micro` for the bill, once per `chargeId` (the order id). */
  prepareCharge(id: string, chargeId: string, micro: bigint): Promise<StellarPreparedTx> {
    return this.prepareWrite(
      this.invoke("charge", [xdr.ScVal.scvBytes(hex32(id)), xdr.ScVal.scvBytes(hex32(chargeId)), nativeToScVal(toStellarUnits(micro), { type: "i128" })]),
    );
  }

  /** Revokes as the operator: the user stopped it in the app. */
  prepareRevoke(id: string): Promise<StellarPreparedTx> {
    return this.prepareWrite(this.invoke("revoke", [new Address(this.operatorAccount).toScVal(), xdr.ScVal.scvBytes(hex32(id))]));
  }

  async getMandate(id: string): Promise<OnChainMandate | null> {
    const v = await this.read("get", [xdr.ScVal.scvBytes(hex32(id))]);
    if (v === undefined) return null;
    const m = v as Record<string, unknown>;
    return {
      owner: String(m.owner),
      capMicro: fromStellarUnits(BigInt(m.cap as bigint)),
      periodSecs: Number(m.period),
      start: Number(m.start),
      end: Number(m.end),
      spentMicro: fromStellarUnits(BigInt(m.spent as bigint)),
      periodIndex: Number(m.period_index),
      revoked: Boolean(m.revoked),
    };
  }

  /** Chargeable right now (micro): zero if revoked, ended or missing. */
  async remaining(id: string): Promise<bigint> {
    const v = await this.read("remaining", [xdr.ScVal.scvBytes(hex32(id))]);
    return v === undefined ? 0n : fromStellarUnits(BigInt(v as bigint));
  }

  /** Usable: exists on chain and not revoked (by Constant or by the user from their own wallet). */
  async isActive(id: string): Promise<boolean> {
    const m = await this.getMandate(id);
    return !!m && !m.revoked && m.end > Math.floor(Date.now() / 1000);
  }

  async balanceMicro(owner: string): Promise<bigint> {
    return (await this.accountState(owner)).usdcMicro;
  }

  // ── Sending ─────────────────────────────────────────────────────────────────

  async broadcast(raw: string): Promise<void> {
    const tx = TransactionBuilder.fromXDR(raw, this.passphrase);
    const res = await this.server.sendTransaction(tx);
    if (res.status === "PENDING" || res.status === "DUPLICATE") return;
    // A rejected transaction never reaches the ledger: the next one is built from the ledger's sequence.
    this.nextSeq = null;
    const detail = res.errorResult ? res.errorResult.result.type : res.status;
    throw new Error(`stellar send ${res.status}: ${detail}`);
  }

  async status(txHash: string, maxTime?: number): Promise<StellarTxState> {
    const res = await this.server.getTransaction(txHash);
    if (res.status === rpc.Api.GetTransactionStatus.SUCCESS) return "confirmed";
    if (res.status === rpc.Api.GetTransactionStatus.FAILED) {
      this.nextSeq = null;
      return "reverted";
    }
    // Not found. Past its time limit (with a ledger's grace) it can never be included.
    if (maxTime && res.latestLedgerCloseTime && Number(res.latestLedgerCloseTime) > maxTime + 10) {
      this.nextSeq = null;
      return "expired";
    }
    return "pending";
  }

  async latestLedger(): Promise<number> {
    return (await this.server.getLatestLedger()).sequence;
  }

  /** The time limit of a prepared transaction (unix seconds), read from its envelope. */
  maxTimeOf(raw: string): number | undefined {
    const tx = TransactionBuilder.fromXDR(raw, this.passphrase);
    const max = "timeBounds" in tx ? Number(tx.timeBounds?.maxTime ?? 0) : 0;
    return max || undefined;
  }

  /** Polls until the transaction is final. For scripts and onboarding; the worker polls on its own schedule. */
  async waitFor(p: StellarPreparedTx, timeoutMs = 90_000): Promise<StellarTxState> {
    const until = Date.now() + timeoutMs;
    for (;;) {
      const st = await this.status(p.hash, p.maxTime);
      if (st !== "pending" || Date.now() > until) return st;
      await new Promise((r) => setTimeout(r, 1_500));
    }
  }

  /** The value a confirmed contract call returned, as a JS value. */
  async returnValue(txHash: string): Promise<unknown> {
    const res = await this.server.getTransaction(txHash);
    if (res.status !== rpc.Api.GetTransactionStatus.SUCCESS) throw new Error(`transaction ${res.status}`);
    return res.returnValue ? scValToNative(res.returnValue) : undefined;
  }

  // ── Internals ────────────────────────────────────────────────────────────────

  private invoke(fn: string, args: xdr.ScVal[], auth?: xdr.SorobanAuthorizationEntry[]): xdr.Operation {
    return Operation.invokeContractFunction({ contract: this.contractId, function: fn, args, ...(auth ? { auth } : {}) });
  }

  private async simulate(op: xdr.Operation): Promise<rpc.Api.SimulateTransactionSuccessResponse> {
    const source = await this.server.getAccount(this.operatorAccount);
    const tx = new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase: this.passphrase }).addOperation(op).setTimeout(30).build();
    const sim = await this.server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(sim)) throw new Error(`simulation failed: ${contractError(sim.error)}`);
    return sim as rpc.Api.SimulateTransactionSuccessResponse;
  }

  /** Read-only call: simulated, never sent. Undefined if the contract refused (a missing mandate). */
  private async read(fn: string, args: xdr.ScVal[]): Promise<unknown> {
    const source = new Account(this.operatorAccount, "0");
    const tx = new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase: this.passphrase }).addOperation(this.invoke(fn, args)).setTimeout(30).build();
    const sim = await this.server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(sim)) {
      if (/Error\(Contract, #2\)/.test(sim.error)) return undefined; // MandateNotFound
      throw new Error(`read ${fn} failed: ${contractError(sim.error)}`);
    }
    const ret = (sim as rpc.Api.SimulateTransactionSuccessResponse).result?.retval;
    return ret ? scValToNative(ret) : undefined;
  }

  private async sequence(): Promise<string> {
    const onLedger = BigInt((await this.server.getAccount(this.operatorAccount)).sequenceNumber());
    if (this.nextSeq === null || this.nextSeq <= onLedger) this.nextSeq = onLedger;
    const use = this.nextSeq;
    this.nextSeq += 1n;
    return use.toString(); // TransactionBuilder adds one
  }

  /** Any operation, simulated and signed by the operator. For deploying; the bill flow uses the methods above. */
  prepareOperation(op: xdr.Operation): Promise<StellarPreparedTx> {
    return this.prepareWrite(op);
  }

  /** Simulate, add resources, sign as the operator. A contract refusal surfaces here, before anything is saved. */
  private async prepareWrite(op: xdr.Operation): Promise<StellarPreparedTx> {
    const sim = await this.simulate(op);
    const source = new Account(this.operatorAccount, await this.sequence());
    const raw = new TransactionBuilder(source, { fee: this.baseFee, networkPassphrase: this.passphrase }).addOperation(op).setTimeout(this.timeoutSecs).build();
    const tx = rpc.assembleTransaction(raw, sim).build();
    tx.sign(this.operator);
    return { hash: toHex(tx.hash()), raw: tx.toXdr(), maxTime: Number(tx.timeBounds?.maxTime ?? 0) };
  }
}

/** create(owner, id, cap, period, end, expiry_ledger). */
function createArgs(t: MandateTerms): xdr.ScVal[] {
  return [
    new Address(t.owner).toScVal(),
    xdr.ScVal.scvBytes(hex32(t.id)),
    nativeToScVal(toStellarUnits(t.capMicro), { type: "i128" }),
    nativeToScVal(t.periodSecs, { type: "u64" }),
    nativeToScVal(t.endAt, { type: "u64" }),
    nativeToScVal(t.expiryLedger, { type: "u32" }),
  ];
}

/** The mandate contract's errors (contracts/mandate/src/lib.rs), by number. */
export const MANDATE_ERRORS: Record<number, string> = {
  1: "MandateExists",
  2: "MandateNotFound",
  3: "InvalidAmount",
  4: "InvalidPeriod",
  5: "Revoked",
  6: "Expired",
  7: "OverCap",
  8: "DuplicateCharge",
  9: "NotAllowed",
  10: "BadExpiry",
};

/** "Error(Contract, #7)" → "OverCap (#7)"; anything else unchanged, trimmed. */
export function contractError(message: string): string {
  const m = /Error\(Contract, #(\d+)\)/.exec(message);
  if (m) return `${MANDATE_ERRORS[Number(m[1])] ?? "contract error"} (#${m[1]})`;
  return message.split("\n")[0]!.slice(0, 300);
}

export type { FeeBumpTransaction };

// ── Deploying ──────────────────────────────────────────────────────────────────

/**
 * Uploads the mandate contract and creates an instance whose constructor sets the operator as admin, the treasury and
 * USDC. Also deploys USDC's Stellar Asset Contract if nobody has yet. For the proof run and the first mainnet deploy;
 * the worker never deploys.
 */
export async function deployMandateContract(o: {
  network: StellarNetwork;
  rpcUrl?: string;
  operatorSecret: string;
  treasury: string;
  wasm: Uint8Array;
  usdc?: { code: string; issuer: string };
}): Promise<{ contractId: string; wasmHash: string; txHashes: string[] }> {
  // A rail without a contract yet, for its sending and simulation plumbing.
  const rail = new StellarRail({ ...o, contractId: StrKey.encodeContract(Buffer.alloc(32)) });
  const txHashes: string[] = [];
  const send = async (op: xdr.Operation) => {
    const p = await rail.prepareOperation(op);
    await rail.broadcast(p.raw);
    const st = await rail.waitFor(p);
    if (st !== "confirmed") throw new Error(`deploy step ${st}: ${p.hash}`);
    txHashes.push(p.hash);
    return p.hash;
  };

  const sac = await rail.server.getContractData(rail.usdcContract, xdr.ScVal.scvLedgerKeyContractInstance()).catch(() => null);
  if (!sac) await send(Operation.createStellarAssetContract({ asset: rail.usdc }));

  const wasmHash = toHex(hash(Buffer.from(o.wasm)));
  await send(Operation.uploadContractWasm({ wasm: Buffer.from(o.wasm) }));
  const created = await send(
    Operation.createCustomContract({
      address: new Address(rail.operatorAccount),
      wasmHash: Buffer.from(wasmHash, "hex"),
      salt: Buffer.from(Keypair.random().rawPublicKey()),
      constructorArgs: [new Address(rail.operatorAccount).toScVal(), new Address(o.treasury).toScVal(), new Address(rail.usdcContract).toScVal()],
    }),
  );
  const contractId = String(await rail.returnValue(created));
  return { contractId, wasmHash, txHashes };
}
