/**
 * Public receipts on Stellar. Once an hour, the Merkle root of every renewal settled since the last batch
 * is written as the memo of a Stellar transaction from Constant's own account. Anyone holding a receipt
 * can recompute its leaf, walk the proof to the root, and find that root on the public ledger.
 *
 * Constant pays the fee (0.00001 XLM); users never hold XLM or see the word (CLAUDE.md rule 10).
 * The transaction's only operation is a no-op sequence bump, so it moves no money.
 */
import { Horizon, Keypair, Memo, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import { STELLAR, type StellarNetwork } from "./config.js";

export interface AnchorResult {
  txHash: string;
  ledger: number | null;
  explorerUrl: string;
}

export interface Anchorer {
  readonly network: StellarNetwork;
  /** Writes a 32-byte hex root as a memo hash. */
  anchor(rootHex: string): Promise<AnchorResult>;
  txUrl(txHash: string): string;
}

export function buildAnchorTx(source: { accountId: string; sequence: string }, rootHex: string, network: StellarNetwork, secret: string) {
  if (!/^[0-9a-f]{64}$/.test(rootHex)) throw new Error("anchor: root must be 32 bytes hex");
  const account = new Horizon.AccountResponse({ id: source.accountId, account_id: source.accountId, sequence: source.sequence } as never);
  const tx = new TransactionBuilder(account, { fee: "1000", networkPassphrase: STELLAR[network].passphrase })
    // bumpTo the current sequence: a valid no-op. The memo is the point.
    .addOperation(Operation.bumpSequence({ bumpTo: source.sequence }))
    .addMemo(Memo.hash(rootHex))
    .setTimeout(120)
    .build();
  tx.sign(Keypair.fromSecret(secret));
  return tx;
}

export class StellarAnchorer implements Anchorer {
  private readonly server: Horizon.Server;
  private readonly keypair: Keypair;

  constructor(
    readonly network: StellarNetwork,
    private readonly secret: string,
  ) {
    this.server = new Horizon.Server(STELLAR[network].horizon);
    this.keypair = Keypair.fromSecret(secret);
  }

  async anchor(rootHex: string): Promise<AnchorResult> {
    const account = await this.server.loadAccount(this.keypair.publicKey());
    const tx = buildAnchorTx({ accountId: account.accountId(), sequence: account.sequenceNumber() }, rootHex, this.network, this.secret);
    const res = await this.server.submitTransaction(tx);
    return { txHash: res.hash, ledger: res.ledger ?? null, explorerUrl: this.txUrl(res.hash) };
  }

  txUrl(txHash: string): string {
    return `${STELLAR[this.network].explorer}/tx/${txHash}`;
  }
}

export class FakeAnchorer implements Anchorer {
  readonly network = "testnet" as const;
  roots: string[] = [];
  failNext = false;
  async anchor(rootHex: string): Promise<AnchorResult> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error("horizon unavailable");
    }
    this.roots.push(rootHex);
    const txHash = rootHex.split("").reverse().join("");
    return { txHash, ledger: 100 + this.roots.length, explorerUrl: this.txUrl(txHash) };
  }
  txUrl(txHash: string) {
    return `${STELLAR.testnet.explorer}/tx/${txHash}`;
  }
}
