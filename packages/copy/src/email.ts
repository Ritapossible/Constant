/**
 * Email versions of the notices (D-092). The words are the same as every channel's (render); email adds a greeting,
 * the app button, and a footer saying why it arrived and how to change it. Plain text goes with every HTML email,
 * for mail apps that don't show HTML. Black and white, inline styles, tables: what mail apps render reliably.
 */
import type { Message, NoticeKind, NoticeParams } from "./index.js";

export interface Email {
  subject: string;
  text: string;
  html: string;
}

export interface EmailContext {
  /** The site, e.g. https://constantunits.xyz; the button opens /app. */
  appUrl: string;
  /** The person's name, if they gave one: the greeting uses the first word. */
  name?: string | null;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

function greeting(name?: string | null): string {
  const first = name?.trim().split(/\s+/)[0];
  return first ? `Hi ${first},` : "Hello,";
}

/** The message body without the SMS-style "ConstantUnits:" prefix. */
function body(m: Message): string {
  const t = m.text.replace(/^ConstantUnits:\s*/, "");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function emailFor(kind: NoticeKind, m: Message, p: NoticeParams, ctx: EmailContext): Email {
  const appLink = `${ctx.appUrl.replace(/\/+$/, "")}/app`;
  const hello = greeting(ctx.name);
  const main = body(m);
  const footer = "You're getting this because you use ConstantUnits. To choose where messages go (email, SMS or Telegram), open the app, then Account.";

  const text = [hello, main, `Open ConstantUnits: ${appLink}`, footer].join("\n\n");

  const token =
    kind === "token" && p.token
      ? `<tr><td style="padding:0 32px 8px"><div style="font:600 17px/1.3 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:0.02em;white-space:nowrap;background:#f6f6f4;border:1px solid #e6e6e2;border-radius:12px;padding:16px;text-align:center;color:#0a0a0a">${esc(p.token)}</div></td></tr>`
      : "";

  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(m.subject)}</title></head>
<body style="margin:0;padding:0;background:#f6f6f4">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f6f4;padding:24px 12px">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e6e6e2;border-radius:20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0a0a0a">
<tr><td style="padding:28px 32px 8px;font:700 17px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;letter-spacing:-0.02em">ConstantUnits</td></tr>
<tr><td style="padding:16px 32px 4px;font-size:22px;line-height:1.3;font-weight:600;letter-spacing:-0.01em">${esc(m.subject)}</td></tr>
<tr><td style="padding:12px 32px 4px;font-size:16px;line-height:1.55;color:#2b2b2b">${esc(hello)}</td></tr>
<tr><td style="padding:8px 32px 16px;font-size:16px;line-height:1.55;color:#2b2b2b">${esc(main)}</td></tr>
${token}
<tr><td style="padding:8px 32px 28px"><a href="${esc(appLink)}" style="display:inline-block;background:#0a0a0a;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:13px 22px;border-radius:999px">Open ConstantUnits</a></td></tr>
<tr><td style="padding:18px 32px 26px;border-top:1px solid #efefeb;font-size:12.5px;line-height:1.5;color:#6b6b6b">${esc(footer)}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  return { subject: m.subject, text, html };
}
