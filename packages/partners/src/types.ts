/**
 * Partner interfaces. The worker and api only ever see these; each has a fake for tests and local dev,
 * and one real adapter per market (ARCHITECTURE "Partner interfaces").
 */

export type CableProvider = "dstv" | "gotv" | "startimes";

export interface CablePlan {
  code: string;
  name: string;
  amountMinor: bigint;
}

export type DecoderLookup =
  | {
      ok: true;
      customerName: string;
      currentPlan: string | null;
      /** What renewing the current plan costs now. Null if the provider didn't say. */
      renewalAmountMinor: bigint | null;
      /** When the current subscription ends. Null if the provider didn't say. */
      dueAt: Date | null;
    }
  | { ok: false; reason: "not_found" | "unreachable" };

/**
 * What a pay or requery call tells us. Only "delivered" settles; only "failed" and "not_found"
 * (after a grace period) release the money; everything else is "ask again" (INV-8, INV-13).
 */
export type VendOutcome =
  | { kind: "delivered"; partnerTxnId: string | null }
  | { kind: "pending"; detail: string }
  | { kind: "failed"; code: string; detail: string }
  | { kind: "reversed"; detail: string }
  | { kind: "not_found" }
  | { kind: "unknown"; detail: string };

export interface CableVending {
  readonly name: string;
  plans(provider: CableProvider): Promise<CablePlan[]>;
  lookup(provider: CableProvider, smartcard: string): Promise<DecoderLookup>;
  /** `requestId` is saved on the order before this is called. */
  renew(req: { requestId: string; provider: CableProvider; smartcard: string; amountMinor: bigint; phone: string }): Promise<VendOutcome>;
  requery(requestId: string): Promise<VendOutcome>;
  /** The partner's id for a new request. Written to the order before the call. */
  newRequestId(orderId: string, now: Date): string;
  /** Webhooks from this partner are unsigned hints; the request id to requery, or null. */
  webhookRequestId(rawBody: string): string | null;
}

export interface DedicatedAccount {
  customerCode: string;
  accountNumber: string;
  bankName: string;
  accountName: string;
}

export interface FundingCredit {
  eventId: string;
  customerCode: string;
  amountMinor: bigint;
  currency: string;
  reference: string;
}

export interface Funding {
  readonly name: string;
  createDedicatedAccount(c: { email: string; firstName: string; lastName: string; phone: string }): Promise<DedicatedAccount>;
  /** False for a bad or missing signature. Checked on the raw bytes before parsing. */
  verifySignature(rawBody: string, headers: Record<string, string | string[] | undefined>): boolean;
  /** A credit to act on, or null for events we ignore. */
  parseCredit(rawBody: string): FundingCredit | null;
}

export type MessageChannel = "email" | "sms";

export interface Messaging {
  readonly channels: readonly MessageChannel[];
  send(channel: MessageChannel, to: string, subject: string, text: string): Promise<{ providerId: string }>;
}

export interface IdentityUser {
  did: string;
  email: string | null;
  phoneE164: string | null;
  /** EVM addresses the identity provider says this user controls: the embedded one it created, and any linked. */
  wallets: { address: string; kind: "embedded" | "external" }[];
}

export interface Identity {
  /** The user's DID from a valid access token, or null. Never throws for a bad token. */
  verify(accessToken: string): Promise<string | null>;
  /** Verified contact details from the identity provider, not from the client. */
  user(did: string): Promise<IdentityUser>;
}
