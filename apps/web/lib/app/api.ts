/** Shapes returned by apps/api. Money is a string of minor units; parse with BigInt. */

export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, "");

export type ServerLine = {
  id: string;
  funding: "naira" | "stables";
  kind: "tv" | "data" | "airtime" | "electricity" | "subscription";
  /** dstv, gotv, startimes; mtn, airtel, glo, 9mobile; ikedc…; chatgpt… */
  provider: string;
  /** due_date: cable. monthly: on renewDay. usage: when reported low or "top up now". none: tracked only. */
  schedule: "due_date" | "monthly" | "usage" | "none";
  renewDay: number | null;
  amountMinor: string | null;
  variationCode: string | null;
  meterType: "prepaid" | "postpaid" | null;
  threshold: number | null;
  weeklyCapMinor: string | null;
  /** "bundle": a data bill moved from the phone that needs a bundle chosen before it can pay. */
  setupNeeded: "bundle" | null;
  verified: boolean;
  readings: { at: string; value: number }[];
  createdAt: string;
  last4: string;
  customerName: string | null;
  planName: string | null;
  nickname: string;
  currency: "NGN" | "USD";
  capMinor: string;
  status: "active" | "paused" | "frozen" | "cancelled";
  frozenReason: string | null;
  dueAt: string | null;
  nextRunAt: string | null;
  lastRenewedAt: string | null;
};

export type ServerOrder = {
  /** Electricity: the owner's token, when the payment delivered one. */
  token: string | null;
  tokenUnits: string | null;
  id: string;
  lineId: string;
  state: "ready" | "vending" | "token_stored" | "notifying" | "settled" | "failed" | "needs_human";
  amountMinor: string;
  feeMinor: string;
  currency: "NGN";
  createdAt: string;
  settledAt: string | null;
  receiptId: string;
};

export type Me = {
  user: { id: string; displayName: string | null; email: string | null; phone: string | null; channels: ("whatsapp" | "telegram" | "sms" | "email")[]; telegram: boolean };
  /** The bot's username when Telegram is on (D-082); null when it isn't. */
  telegramBot: string | null;
  balance: { currency: "NGN"; ledgerMinor: string; availableMinor: string };
  fundingAccount: { bankName: string; accountNumber: string; accountName: string } | null;
  lines: ServerLine[];
  orders: ServerOrder[];
  payments: "on" | "paused";
  /** Card, USSD and QR top-ups are open (D-075). */
  cardTopUps: boolean;
};

export type Topup = {
  id: string;
  status: "pending" | "credited" | "failed" | "mismatch";
  creditMinor: string;
  feeMinor: string;
  totalMinor: string;
  authorizationUrl: string | null;
  createdAt: string;
};

export type DataPlan = { code: string; name: string; amountMinor: string };
export type MeterCheck = { customerName: string; address: string | null; meterType: "prepaid" | "postpaid" };
export type Session = { current: boolean; device: string; signedInAt: string; lastSeenAt: string };

export type Lookup = { customerName: string; currentPlan: string | null; renewalAmountMinor: string | null; dueAt: string | null };

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export type StableDeposit = {
  id: string;
  network: string;
  symbol: "USDC" | "USDT" | null;
  amount: string | null;
  status: "accepted" | "quarantined";
  txUrl: string;
  at: string;
};

export type Stables = { addresses: { address: string; kind: "embedded" | "external" }[]; deposits: StableDeposit[] };

export type PublicReceipt = {
  receiptId: string;
  status: "paid" | "not_paid" | "in_progress";
  amountMinor: string;
  currency: "NGN";
  provider: string;
  last4: string;
  createdAt: string;
  paidAt: string | null;
  record: { leaf: string; proof: string[]; root: string; network: string; txHash: string; url: string; recordedAt: string | null } | null;
};
