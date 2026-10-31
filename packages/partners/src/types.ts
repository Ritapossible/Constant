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
  /** `token`: the electricity token (prepaid meters), with its units when the DisCo said. */
  | { kind: "delivered"; partnerTxnId: string | null; token?: string | null; units?: string | null }
  | { kind: "pending"; detail: string }
  | { kind: "failed"; code: string; detail: string }
  | { kind: "reversed"; detail: string }
  | { kind: "not_found" }
  | { kind: "unknown"; detail: string };

/** Bills paid through the vend partner (D-079). Providers are ConstantUnits's codes ('mtn', 'ikedc', 'dstv'). */
export type VendKind = "tv" | "data" | "airtime" | "electricity";
export type MeterType = "prepaid" | "postpaid";

export interface DataPlan {
  code: string;
  name: string;
  amountMinor: bigint;
}

export type MeterLookup =
  | { ok: true; customerName: string; address: string | null; meterType: MeterType }
  | { ok: false; reason: "not_found" | "unreachable" };

/** One payment. `ref` is the phone, meter or smartcard; `variationCode` the data bundle; `meterType` for power. */
export interface VendRequest {
  requestId: string;
  kind: VendKind;
  provider: string;
  ref: string;
  amountMinor: bigint;
  phone: string;
  variationCode?: string | null;
  meterType?: MeterType | null;
}

export interface CableVending {
  readonly name: string;
  /** Data bundles a network sells now, with today's prices. */
  dataPlans(network: string): Promise<DataPlan[]>;
  lookupMeter(provider: string, meter: string, meterType: MeterType): Promise<MeterLookup>;
  /** Data, airtime and electricity. `requestId` is saved on the order before this is called. */
  vend(req: VendRequest): Promise<VendOutcome>;
  plans(provider: CableProvider): Promise<CablePlan[]>;
  lookup(provider: CableProvider, smartcard: string): Promise<DecoderLookup>;
  /** `requestId` is saved on the order before this is called. */
  renew(req: { requestId: string; provider: CableProvider; smartcard: string; amountMinor: bigint; phone: string }): Promise<VendOutcome>;
  requery(requestId: string): Promise<VendOutcome>;
  /** The partner's id for a new request. Written to the order before the call. */
  newRequestId(orderId: string, now: Date): string;
  /** Webhooks from this partner are unsigned hints; the request id to requery, or null. */
  webhookRequestId(rawBody: string): string | null;
  /** Constant's prefunded naira at the partner (the float every vend is paid from), rounded down to the kobo. */
  floatBalance(): Promise<bigint>;
}

export type ScreeningResult = { result: "clear" } | { result: "flagged"; detail: string };

/** Sanctions and risk screening of blockchain addresses before their money is used (from review, 2026-10-10). */
export interface AddressScreener {
  screen(address: string): Promise<ScreeningResult>;
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
  /** The name on the account the transfer came from, when the bank sent it (D-088). */
  senderName: string | null;
}

/** A customer's identity check (D-086), from a signed webhook. */
export interface IdentificationResult {
  customerCode: string;
  verified: boolean;
  /** Why it failed, in the provider's words. */
  reason: string | null;
}

export interface Funding {
  readonly name: string;
  createDedicatedAccount(c: { email: string; firstName: string; lastName: string; phone: string }): Promise<DedicatedAccount>;
  /** Creates (or finds, by email) the provider's customer and returns its code. */
  ensureCustomer(c: { email: string; firstName: string; lastName: string; phone: string }): Promise<string>;
  /**
   * Asks the provider to check a BVN against a bank account in the customer's name. The answer arrives later as a
   * webhook (parseIdentification). The BVN is passed through, never stored.
   */
  validateCustomer(customerCode: string, c: { bvn: string; accountNumber: string; bankCode: string; firstName: string; lastName: string }): Promise<void>;
  /** The account number for a validated customer. */
  assignAccount(customerCode: string): Promise<DedicatedAccount>;
  parseIdentification(rawBody: string): IdentificationResult | null;
  /** False for a bad or missing signature. Checked on the raw bytes before parsing. */
  verifySignature(rawBody: string, headers: Record<string, string | string[] | undefined>): boolean;
  /** A credit to act on, or null for events we ignore. */
  parseCredit(rawBody: string): FundingCredit | null;
}

/** A hosted checkout for one top-up (card, USSD, QR, pay with transfer). D-075. */
export interface CheckoutStart {
  authorizationUrl: string;
}

/** What the provider says happened to a checkout: from a signed webhook or a verify call. */
export interface CheckoutResult {
  reference: string;
  status: "success" | "failed" | "pending";
  /** The provider's transaction id: the funding event id, so a payment credits once. Null until it exists. */
  eventId: string | null;
  amountMinor: bigint | null;
  currency: string | null;
  channel: string | null;
  feesMinor: bigint | null;
}

export interface Checkout {
  readonly name: string;
  start(c: { email: string; reference: string; totalMinor: bigint; callbackUrl: string; metadata: Record<string, string> }): Promise<CheckoutStart>;
  verify(reference: string): Promise<CheckoutResult>;
  /** A signed checkout payment event, or null for anything else (dedicated-account credits stay with Funding). */
  parseCheckout(rawBody: string): CheckoutResult | null;
}

export type MessageChannel = "email" | "sms" | "telegram";

export interface Messaging {
  readonly channels: readonly MessageChannel[];
  /** `html` is an email's formatted version; `text` always goes too, and is all other channels send. */
  send(channel: MessageChannel, to: string, subject: string, text: string, html?: string): Promise<{ providerId: string }>;
}

export interface IdentityUser {
  did: string;
  email: string | null;
  phoneE164: string | null;
  /**
   * EVM addresses the identity provider says this user controls: the embedded signer it created, any linked
   * wallet, and the smart wallet (a Coinbase Smart Wallet on Base) that holds dollars for autopay.
   */
  wallets: { address: string; kind: "embedded" | "external" | "smart" }[];
}

export interface Identity {
  /**
   * The user's DID and the provider's session id (`sid`) from a valid access token, or null. Never throws for a bad
   * token. `sid` is null if the provider didn't include one.
   */
  verify(accessToken: string): Promise<{ did: string; sid: string | null } | null>;
  /** Verified contact details from the identity provider, not from the client. */
  user(did: string): Promise<IdentityUser>;
  /** Deletes the person's sign-in account (and its embedded wallet) at the provider. Idempotent. */
  deleteUser(did: string): Promise<void>;
}

export interface Bank {
  code: string;
  name: string;
}

export type TransferOutcome =
  | { kind: "sent"; transferCode: string | null }
  | { kind: "succeeded"; transferCode: string | null }
  | { kind: "failed"; detail: string }
  | { kind: "needs_otp" }
  | { kind: "not_found" }
  | { kind: "unknown"; detail: string };

export interface TransferEvent {
  reference: string;
  status: "succeeded" | "failed" | "reversed";
}

/** Naira payouts to a user's own bank account (D-067). */
export interface Payouts {
  readonly name: string;
  banks(): Promise<Bank[]>;
  /** The bank's name for this account, or null if it doesn't exist. */
  resolveAccount(bankCode: string, accountNumber: string): Promise<string | null>;
  createRecipient(r: { name: string; bankCode: string; accountNumber: string }): Promise<string>;
  /** Idempotent by reference: the same reference never pays twice. */
  transfer(t: { reference: string; recipientCode: string; amountMinor: bigint; reason: string }): Promise<TransferOutcome>;
  verifyTransfer(reference: string): Promise<TransferOutcome>;
  /** A transfer event from a signed webhook body (signature checked separately), or null. */
  parseTransferEvent(rawBody: string): TransferEvent | null;
}
