/**
 * An in-memory stand-in for StellarRail with the mandate contract's rules (contracts/mandate), for the worker and API
 * tests. Transactions apply when sent, unless `dropNext` is set: then the network never includes them, and past their
 * time limit they read as "expired", as on Stellar.
 */
import { createHash, randomBytes } from "node:crypto";
import { Keypair } from "@stellar/stellar-sdk";
import { STELLAR } from "./config.js";
import { verifyStellarSignature, type MandateDraft, type MandateTerms, type OnChainMandate, type OnboardingTx, type StellarPreparedTx, type StellarTxState } from "./soroban.js";

interface FakeMandate extends OnChainMandate {
  periods: number;
}

export class FakeStellarRail {
  /** Tests set "public" to check what changes on the real network. */
  network: "testnet" | "public" = "testnet";
  readonly passphrase = STELLAR.testnet.passphrase;
  readonly contractId = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
  readonly usdcContract = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
  readonly operatorAccount = Keypair.random().publicKey();
  ledger = 1_000;
  mandates = new Map<string, FakeMandate>();
  balances = new Map<string, bigint>();
  accounts = new Map<string, { exists: boolean; trustline: boolean }>();
  chargeIds = new Set<string>();
  treasuryMicro = 0n;
  sent: { fn: string; hash: string }[] = [];
  /** The next transaction sent never reaches the ledger. */
  dropNext = false;
  private txs = new Map<string, { state: StellarTxState; maxTime: number }>();
  private pending = new Map<string, { fn: string; maxTime: number; apply: () => void }>();

  constructor(private readonly clock: () => Date = () => new Date()) {}

  private nowSecs() {
    return Math.floor(this.clock().getTime() / 1000);
  }

  contractUrl(id = this.contractId) {
    return `${STELLAR.testnet.explorer}/contract/${id}`;
  }

  txUrl(hash: string) {
    return `${STELLAR.testnet.explorer}/tx/${hash}`;
  }

  async latestLedger() {
    return this.ledger;
  }

  async accountState(owner: string) {
    const a = this.accounts.get(owner) ?? { exists: false, trustline: false };
    return { ...a, usdcMicro: this.balances.get(owner) ?? 0n, xlmStroops: 0n };
  }

  async prepareOnboarding(owner: string): Promise<OnboardingTx | null> {
    const a = this.accounts.get(owner);
    if (a?.exists && a.trustline) return null;
    const hash = randomBytes(32).toString("hex");
    return { xdr: Buffer.from(JSON.stringify({ onboard: owner, hash })).toString("base64"), hash };
  }

  async submitOnboarding(owner: string, tx: OnboardingTx, signatureHex: string): Promise<string> {
    if (!verifyStellarSignature(owner, tx.hash, signatureHex)) throw new Error("signature doesn't match the account");
    this.accounts.set(owner, { exists: true, trustline: true });
    return tx.hash;
  }

  signatureIn(_signedXdr: string, _account: string, _hash: string): string | null {
    return null;
  }

  async draftMandate(terms: MandateTerms, validForLedgers = 1_440): Promise<MandateDraft> {
    const t = { ...terms, expiryLedger: this.ledger + 120 * 17_280 };
    const payload = createHash("sha256").update(JSON.stringify({ ...t, capMicro: t.capMicro.toString() })).digest("hex");
    return { terms: t, entry: Buffer.from(JSON.stringify({ unsigned: payload })).toString("base64"), validUntilLedger: this.ledger + validForLedgers, payload, preimage: payload };
  }

  async signDraft(draft: MandateDraft, signatureHex: string): Promise<string> {
    if (!verifyStellarSignature(draft.terms.owner, draft.payload, signatureHex)) throw new Error("signature doesn't match the account");
    return Buffer.from(JSON.stringify({ signed: draft.payload, signature: signatureHex })).toString("base64");
  }

  async prepareCreate(t: MandateTerms, _signedEntry: string): Promise<StellarPreparedTx> {
    if (this.mandates.has(t.id)) throw new Error("simulation failed: MandateExists (#1)");
    return this.prepare("create", () => {
      if (this.mandates.has(t.id)) throw new Error("MandateExists");
      const start = this.nowSecs();
      this.mandates.set(t.id, {
        owner: t.owner,
        capMicro: t.capMicro,
        periodSecs: t.periodSecs,
        start,
        end: t.endAt,
        spentMicro: 0n,
        periodIndex: 0,
        revoked: false,
        periods: Math.ceil((t.endAt - start) / t.periodSecs),
      });
    });
  }

  async prepareCharge(id: string, chargeId: string, micro: bigint): Promise<StellarPreparedTx> {
    const check = () => {
      const m = this.mandates.get(id);
      if (!m) throw new Error("simulation failed: MandateNotFound (#2)");
      if (this.chargeIds.has(chargeId)) throw new Error("simulation failed: DuplicateCharge (#8)");
      if (m.revoked) throw new Error("simulation failed: Revoked (#5)");
      if (this.nowSecs() >= m.end) throw new Error("simulation failed: Expired (#6)");
      this.roll(m);
      if (m.spentMicro + micro > m.capMicro) throw new Error("simulation failed: OverCap (#7)");
      if ((this.balances.get(m.owner) ?? 0n) < micro) throw new Error("simulation failed: balance");
      return m;
    };
    check();
    return this.prepare("charge", () => {
      const m = check();
      m.spentMicro += micro;
      this.chargeIds.add(chargeId);
      this.balances.set(m.owner, (this.balances.get(m.owner) ?? 0n) - micro);
      this.treasuryMicro += micro;
    });
  }

  async prepareRevoke(id: string): Promise<StellarPreparedTx> {
    return this.prepare("revoke", () => {
      const m = this.mandates.get(id);
      if (!m || m.revoked) throw new Error("Revoked");
      m.revoked = true;
    });
  }

  async getMandate(id: string): Promise<OnChainMandate | null> {
    const m = this.mandates.get(id);
    if (!m) return null;
    this.roll(m);
    return { ...m };
  }

  async remaining(id: string): Promise<bigint> {
    const m = this.mandates.get(id);
    if (!m || m.revoked || this.nowSecs() >= m.end) return 0n;
    this.roll(m);
    return m.capMicro - m.spentMicro;
  }

  async isActive(id: string): Promise<boolean> {
    const m = this.mandates.get(id);
    return !!m && !m.revoked && m.end > this.nowSecs();
  }

  async balanceMicro(owner: string): Promise<bigint> {
    return this.balances.get(owner) ?? 0n;
  }

  async broadcast(raw: string): Promise<void> {
    const { hash } = JSON.parse(Buffer.from(raw, "base64").toString()) as { hash: string };
    const p = this.pending.get(hash);
    if (!p) {
      if (this.txs.has(hash)) return; // DUPLICATE
      throw new Error("stellar send ERROR: unknown transaction");
    }
    this.pending.delete(hash);
    this.sent.push({ fn: p.fn, hash });
    if (this.dropNext) {
      this.dropNext = false;
      this.txs.set(hash, { state: "pending", maxTime: p.maxTime });
      return;
    }
    try {
      p.apply();
      this.txs.set(hash, { state: "confirmed", maxTime: p.maxTime });
    } catch {
      this.txs.set(hash, { state: "reverted", maxTime: p.maxTime });
    }
    this.ledger += 1;
  }

  async status(hash: string, maxTime?: number): Promise<StellarTxState> {
    const t = this.txs.get(hash);
    if (t && t.state !== "pending") return t.state;
    if (maxTime && this.nowSecs() > maxTime + 10) return "expired";
    return "pending";
  }

  maxTimeOf(raw: string): number | undefined {
    return (JSON.parse(Buffer.from(raw, "base64").toString()) as { maxTime: number }).maxTime;
  }

  private roll(m: FakeMandate) {
    const index = Math.floor((this.nowSecs() - m.start) / m.periodSecs);
    if (index !== m.periodIndex) {
      m.periodIndex = index;
      m.spentMicro = 0n;
    }
  }

  private prepare(fn: string, apply: () => void): StellarPreparedTx {
    const hash = randomBytes(32).toString("hex");
    const maxTime = this.nowSecs() + 300;
    this.pending.set(hash, { fn, maxTime, apply });
    return { hash, raw: Buffer.from(JSON.stringify({ hash, maxTime })).toString("base64"), maxTime };
  }
}
