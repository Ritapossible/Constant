/**
 * Messages to users. Email via Resend, SMS via Termii (D-025). WhatsApp and Telegram follow (PLAN step 7).
 */
import { fetchJson, type Fetch } from "./http.js";
import type { MessageChannel, Messaging } from "./types.js";

export interface MessagingConfig {
  resend?: { apiKey: string; from: string };
  termii?: { apiKey: string; senderId: string; baseUrl?: string };
  fetch?: Fetch;
}

export class MessagingError extends Error {}

export class HttpMessaging implements Messaging {
  readonly channels: readonly MessageChannel[];
  private readonly f: Fetch;

  constructor(private readonly c: MessagingConfig) {
    this.f = c.fetch ?? fetch;
    this.channels = [...(c.resend ? (["email"] as const) : []), ...(c.termii ? (["sms"] as const) : [])];
  }

  async send(channel: MessageChannel, to: string, subject: string, text: string): Promise<{ providerId: string }> {
    if (channel === "email" && this.c.resend) {
      const res = await fetchJson(this.f, "https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${this.c.resend.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ from: this.c.resend.from, to: [to], subject, text }),
        timeoutMs: 15_000,
      });
      const id = (res.body as { id?: string })?.id;
      if (res.status >= 300 || !id) throw new MessagingError(`email failed (${res.status})`);
      return { providerId: id };
    }
    if (channel === "sms" && this.c.termii) {
      const res = await fetchJson(this.f, `${this.c.termii.baseUrl ?? "https://v3.api.termii.com"}/api/sms/send`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ to: to.replace(/^\+/, ""), from: this.c.termii.senderId, sms: text, type: "plain", channel: "generic", api_key: this.c.termii.apiKey }),
        timeoutMs: 15_000,
      });
      const id = (res.body as { message_id?: string })?.message_id;
      if (res.status >= 300 || !id) throw new MessagingError(`sms failed (${res.status})`);
      return { providerId: id };
    }
    throw new MessagingError(`channel ${channel} is not configured`);
  }
}

export class FakeMessaging implements Messaging {
  readonly channels: readonly MessageChannel[] = ["email", "sms"];
  readonly sent: { channel: MessageChannel; to: string; subject: string; text: string }[] = [];
  failNext = 0;

  async send(channel: MessageChannel, to: string, subject: string, text: string): Promise<{ providerId: string }> {
    if (this.failNext > 0) {
      this.failNext -= 1;
      throw new Error("fake send failure");
    }
    this.sent.push({ channel, to, subject, text });
    return { providerId: `msg-${this.sent.length}` };
  }
}
