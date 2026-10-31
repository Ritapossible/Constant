/**
 * Telegram (D-082): tokens, receipts and warnings by bot message, and STOP / START replies. Bot API docs:
 * core.telegram.org/bots/api (sendMessage, setWebhook with secret_token). The token stays server-side.
 */
import { fetchJson, type Fetch } from "./http.js";
import { MessagingError } from "./messaging.js";
import type { MessageChannel, Messaging } from "./types.js";

export interface TelegramConfig {
  botToken: string;
  fetch?: Fetch;
}

/** A text message a person sent the bot, from a webhook update. */
export interface TelegramMessage {
  chatId: string;
  text: string;
}

export class Telegram {
  private readonly f: Fetch;

  constructor(private readonly c: TelegramConfig) {
    this.f = c.fetch ?? fetch;
  }

  private async call(method: string, body: Record<string, unknown>): Promise<unknown> {
    const res = await fetchJson(this.f, `https://api.telegram.org/bot${this.c.botToken}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      timeoutMs: 15_000,
    });
    const b = res.body as { ok?: boolean; result?: unknown; description?: string };
    // The token is in the URL: never echo the request, only Telegram's own description.
    if (res.status >= 300 || !b?.ok) throw new MessagingError(`telegram ${method} failed (${res.status}${b?.description ? `: ${b.description}` : ""})`);
    return b.result;
  }

  async sendMessage(chatId: string, text: string): Promise<{ messageId: string }> {
    const r = (await this.call("sendMessage", { chat_id: chatId, text, disable_web_page_preview: true })) as { message_id?: number };
    return { messageId: String(r?.message_id ?? "") };
  }

  /** Points the bot at our webhook. Telegram then sends `secret` in X-Telegram-Bot-Api-Secret-Token on every update. */
  async setWebhook(url: string, secret: string): Promise<void> {
    await this.call("setWebhook", { url, secret_token: secret, allowed_updates: ["message"], drop_pending_updates: false });
  }
}

/** The chat and text of a private message, or null for anything else (groups, edits, stickers). */
export function parseTelegramUpdate(raw: string): TelegramMessage | null {
  try {
    const u = JSON.parse(raw) as { message?: { chat?: { id?: unknown; type?: unknown }; text?: unknown } };
    const m = u.message;
    if (!m || m.chat?.type !== "private" || typeof m.text !== "string") return null;
    if (typeof m.chat.id !== "number" && typeof m.chat.id !== "string") return null;
    return { chatId: String(m.chat.id), text: m.text.trim().slice(0, 200) };
  } catch {
    return null;
  }
}

/** Adds Telegram to another messaging setup (real email and SMS, or the fake used while testing). */
export function withTelegram(base: Messaging, tg: Telegram): Messaging {
  return {
    channels: [...base.channels.filter((c) => c !== "telegram"), "telegram"] as MessageChannel[],
    async send(channel, to, subject, text, html) {
      if (channel !== "telegram") return base.send(channel, to, subject, text, html);
      const r = await tg.sendMessage(to, text);
      return { providerId: r.messageId };
    },
  };
}
