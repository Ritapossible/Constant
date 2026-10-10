/**
 * What a public receipt commits to. The receipt id is 128 random bits, so a leaf can't be guessed from
 * the amount and date alone; nothing personal (no name, no full number) goes in.
 */
import { leafHash } from "./merkle.js";

export interface ReceiptFacts {
  receiptId: string;
  amountMinor: bigint;
  currency: string;
  provider: string;
  last4: string;
  settledAt: Date;
}

export function receiptLeafData(r: ReceiptFacts): string {
  return ["constant.receipt.v1", r.receiptId, r.amountMinor.toString(), r.currency, r.provider, r.last4, r.settledAt.toISOString()].join("|");
}

export const receiptLeaf = (r: ReceiptFacts) => leafHash(receiptLeafData(r));
