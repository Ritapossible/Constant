/**
 * Stablecoin messages, for users who funded with stablecoins. The only copy allowed to name tokens and
 * networks (D-053); scripts/guard.sh allow-lists this file. Never sent to naira-only users.
 */
import type { Message } from "./index.js";

export type StableNoticeKind = "stables_arrived" | "token_quarantined";

export interface StableParams {
  amount?: string;
  symbol?: string;
  network?: string;
}

export function renderStables(kind: StableNoticeKind, p: StableParams): Message {
  switch (kind) {
    case "stables_arrived":
      return {
        subject: `${p.amount} ${p.symbol} arrived`,
        text: `Constant: ${p.amount} ${p.symbol} arrived on ${p.network}. It stays in your own account until you choose a bill for it.`,
      };
    case "token_quarantined":
      return {
        subject: `A token we don't accept arrived`,
        text: `Constant: a token we don't accept arrived at your ${p.network} address. We can't use it for bills. Send only USDC or USDT on Base, or USDC on Arc.`,
      };
  }
}
