/** Shapes returned by apps/api. Money is a string of minor units; parse with BigInt. */

export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, "");

export type ServerLine = {
  id: string;
  kind: "tv";
  provider: "dstv" | "gotv" | "startimes";
  last4: string;
  customerName: string | null;
  planName: string | null;
  nickname: string;
  currency: "NGN";
  capMinor: string;
  status: "active" | "paused" | "frozen" | "cancelled";
  frozenReason: string | null;
  dueAt: string | null;
  nextRunAt: string | null;
  lastRenewedAt: string | null;
};

export type ServerOrder = {
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
  user: { id: string; displayName: string | null; email: string | null; phone: string | null };
  balance: { currency: "NGN"; ledgerMinor: string; availableMinor: string };
  fundingAccount: { bankName: string; accountNumber: string; accountName: string } | null;
  lines: ServerLine[];
  orders: ServerOrder[];
  payments: "on" | "paused";
};

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
