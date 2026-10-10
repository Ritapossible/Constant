/**
 * Stablecoin messages, for users who funded with stablecoins. The only copy allowed to name tokens and
 * networks (D-053); scripts/guard.sh allow-lists this file. Never sent to naira-only users.
 */
import type { Message } from "./index.js";

export type StableNoticeKind =
  | "stables_arrived"
  | "token_quarantined"
  | "stables_short"
  | "allowance_low"
  | "permission_needed"
  | "permission_on"
  | "permission_failed";

export const STABLE_KINDS: ReadonlySet<string> = new Set([
  "stables_arrived",
  "token_quarantined",
  "stables_short",
  "allowance_low",
  "permission_needed",
  "permission_on",
  "permission_failed",
]);

export interface StableParams {
  amount?: string;
  symbol?: string;
  network?: string;
  line?: string;
  usd?: string;
  have?: string;
}

export function renderStables(kind: StableNoticeKind, p: StableParams): Message {
  switch (kind) {
    case "stables_arrived":
      return {
        subject: `${p.amount} ${p.symbol} arrived`,
        text: `Constant: ${p.amount} ${p.symbol} arrived on ${p.network}. It stays in your own account until you choose a bill for it.`,
      };
    case "stables_short":
      return {
        subject: `Add USDC for ${p.line}`,
        text: `Constant: ${p.line} is due and needs about ${p.usd} USDC on Base. Your account has ${p.have}. Add USDC and we'll pay it.`,
      };
    case "allowance_low":
      return {
        subject: `${p.line} needs a higher limit`,
        text: `Constant: ${p.line} now needs ${p.usd} USDC, more than you allowed this month. Raise the limit in the app and we'll pay it.`,
      };
    case "permission_needed":
      return {
        subject: `Confirm ${p.line} again`,
        text: `Constant: we can't charge USDC for ${p.line} until you confirm it again in the app.`,
      };
    case "permission_on":
      return {
        subject: `${p.line} now pays from USDC`,
        text: `Constant: ${p.line} now pays from your USDC on Base, up to ${p.usd} every 30 days. Stop any time in the app.`,
      };
    case "permission_failed":
      return {
        subject: `${p.line} couldn't be set up`,
        text: `Constant: we couldn't switch ${p.line} to USDC. Nothing was charged. Try again in the app.`,
      };
    case "token_quarantined":
      return {
        subject: `A token we don't accept arrived`,
        text: `Constant: a token we don't accept arrived at your ${p.network} address. We can't use it for bills. Send only USDC or USDT on Base, or USDC on Arc.`,
      };
  }
}
