import { NextResponse } from "next/server";

/**
 * Early-access sign-ups. Each sign-up is forwarded to WAITLIST_WEBHOOK_URL
 * (any JSON webhook: Slack, Discord, Zapier, Google Apps Script…) and/or to a
 * Telegram chat via TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID. If neither is set,
 * the request fails loudly instead of silently dropping the contact.
 */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function normalise(raw: unknown): { kind: "email" | "phone"; value: string } | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  if (v.length < 5 || v.length > 120) return null;
  if (EMAIL.test(v)) return { kind: "email", value: v.toLowerCase() };
  const digits = v.replace(/[\s()-]/g, "");
  if (/^\+?\d{10,15}$/.test(digits)) {
    // Nigerian local numbers (0803…) become +234803…
    const e164 = digits.startsWith("+") ? digits : digits.startsWith("0") && digits.length === 11 ? `+234${digits.slice(1)}` : `+${digits}`;
    return { kind: "phone", value: e164 };
  }
  return null;
}

export async function POST(req: Request) {
  let body: { contact?: unknown; company?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  // Honeypot: bots fill hidden fields. Pretend success, store nothing.
  if (typeof body.company === "string" && body.company.length > 0) {
    return NextResponse.json({ ok: true });
  }

  const contact = normalise(body.contact);
  if (!contact) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const entry = {
    ...contact,
    at: new Date().toISOString(),
    country: req.headers.get("x-vercel-ip-country") ?? undefined,
    source: "website",
  };

  const webhook = process.env.WAITLIST_WEBHOOK_URL;
  const tgToken = process.env.TELEGRAM_BOT_TOKEN;
  const tgChat = process.env.TELEGRAM_CHAT_ID;
  if (!webhook && !(tgToken && tgChat)) {
    console.error("waitlist: no destination configured (set WAITLIST_WEBHOOK_URL or TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID)");
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  const jobs: Promise<Response>[] = [];
  if (webhook) {
    jobs.push(
      fetch(webhook, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: `New Constant sign-up: ${entry.value}`, ...entry }),
      }),
    );
  }
  if (tgToken && tgChat) {
    jobs.push(
      fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: tgChat,
          text: `New Constant sign-up\n${entry.kind}: ${entry.value}\ncountry: ${entry.country ?? "?"}\n${entry.at}`,
        }),
      }),
    );
  }

  const results = await Promise.allSettled(jobs);
  const saved = results.some((r) => r.status === "fulfilled" && r.value.ok);
  if (!saved) {
    console.error("waitlist: every destination failed");
    return NextResponse.json({ error: "unavailable" }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
