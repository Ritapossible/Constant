/**
 * Inbound text commands and who may use them. Invariant 10.
 *
 * Commands are exact words, case-insensitive. We forgive surrounding spaces and
 * one trailing full stop or exclamation mark, because phones add them.
 * Onboarding answers are handled by the onboarding flow before this runs.
 */
import type { SiteMode } from "./types.js";

export type CommandWord = "LOW" | "SKIP" | "STOP" | "START" | "BALANCE";

export interface Command {
  word: CommandWord;
  /** Last four digits of a meter, when the sender names one: "STOP 6781". */
  meterLast4?: string;
}

const TARGETABLE: ReadonlySet<CommandWord> = new Set(["LOW", "SKIP", "STOP", "START"]);
const WORDS: ReadonlySet<string> = new Set(["LOW", "SKIP", "STOP", "START", "BALANCE"]);

export function parseCommand(raw: string): Command | null {
  const text = raw.trim().replace(/[.!]$/, "").trim().replace(/\s+/g, " ").toUpperCase();
  const [head, tail, ...rest] = text.split(" ");
  if (!head || rest.length > 0 || !WORDS.has(head)) return null;
  const word = head as CommandWord;
  if (tail === undefined) return { word };
  if (TARGETABLE.has(word) && /^\d{4}$/.test(tail)) return { word, meterLast4: tail };
  return null;
}

export interface SenderRoles {
  isOwner: boolean;
  isSitePhone: boolean;
}

/** Commands the phone at the premises may send. Everything else is owner-only. */
const SITE_PHONE_WORDS: ReadonlySet<CommandWord> = new Set(["LOW", "SKIP"]);

export type InboundRoute =
  | { kind: "command"; command: Command }
  | { kind: "unit_reading"; text: string }
  | { kind: "reply"; reply: InboundReply };

export type InboundReply =
  /** Sender is neither an owner nor a site phone. */
  | "not_a_customer"
  /** A site phone tried an owner-only command. */
  | "owner_only"
  /** LOW on an alert site. Invariant 18. */
  | "alert_site_cannot_buy"
  /** A number sent to a schedule site. */
  | "schedule_site_number"
  /** Anything else. Reply with the short help. */
  | "help";

/**
 * Route one inbound message for one site context.
 * `siteMode` is the mode of the site the message is about, or null when the
 * sender has several sites and did not say which (the caller asks).
 */
export function routeInbound(roles: SenderRoles, text: string, siteMode: SiteMode | null): InboundRoute {
  if (!roles.isOwner && !roles.isSitePhone) return { kind: "reply", reply: "not_a_customer" };

  const command = parseCommand(text);
  if (command) {
    if (!roles.isOwner && !SITE_PHONE_WORDS.has(command.word)) return { kind: "reply", reply: "owner_only" };
    if (command.word === "LOW" && siteMode === "alert") return { kind: "reply", reply: "alert_site_cannot_buy" };
    return { kind: "command", command };
  }

  if (/^\s*\d/.test(text)) {
    if (siteMode === "alert" && roles.isSitePhone) return { kind: "unit_reading", text };
    if (siteMode === "schedule") return { kind: "reply", reply: "schedule_site_number" };
  }
  return { kind: "reply", reply: "help" };
}
