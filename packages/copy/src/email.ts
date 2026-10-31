/**
 * Email versions of the notices (D-092, D-094). The words are every channel's (render); email adds the brand mark, a
 * greeting, one button, and a footer saying why it arrived and how to change it. Plain text goes with every HTML email,
 * for mail apps that don't show HTML. Inline styles and tables, because that's what mail apps render reliably.
 *
 * One neutral ramp (ink, text, muted, line, page), weights 400 and 500 (600 only in the wordmark, as on the site),
 * spacing on a 4px grid, one hairline grey. Images are PNG: mail apps don't show SVG.
 */
import type { Message, NoticeKind, NoticeParams } from "./index.js";

export interface Email {
  subject: string;
  text: string;
  html: string;
}

export interface EmailContext {
  /** The site, e.g. https://constantunits.xyz; the button opens /app, the mark is /email/mark.png. */
  appUrl: string;
  /** The person's name, if they gave one: the greeting uses the first word. */
  name?: string | null;
}

const INK = "#0a0a0a";
const TEXT = "#2b2b2b";
const MUTED = "#6b6b6b";
const LINE = "#e8e8e4";
const PAGE = "#f6f6f4";
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";

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

/**
 * What the email says, when it says more than the SMS. The welcome explains the product and how to start (D-093);
 * every other notice uses its one message.
 */
function content(kind: NoticeKind, m: Message, p: NoticeParams): { paragraphs: string[]; steps: string[]; button: string } {
  if (kind === "welcome") {
    return {
      paragraphs: [
        "ConstantUnits pays your data, airtime, light and TV from money you set aside, on the day you choose and never above the limit you set.",
        p.preview === "1" ? "Bill payments switch on soon. Until then you can set everything up." : "Your first bill is paid as soon as there's money for it.",
      ],
      steps: ["Add a bill: data, airtime, light or TV", "Set its limit: the most it may ever cost", "Add money by bank transfer, card or USSD"],
      button: "Add your first bill",
    };
  }
  return { paragraphs: [body(m)], steps: [], button: "Open ConstantUnits" };
}

export function emailFor(kind: NoticeKind, m: Message, p: NoticeParams, ctx: EmailContext): Email {
  const site = ctx.appUrl.replace(/\/+$/, "");
  const appLink = `${site}/app`;
  const hello = greeting(ctx.name);
  const { paragraphs, steps, button } = content(kind, m, p);
  const footer = "You're getting this because you use ConstantUnits. To choose where messages go (email, SMS or Telegram), open the app, then Account.";

  const text = [
    hello,
    ...paragraphs,
    ...(steps.length ? [steps.map((x, i) => `${i + 1}. ${x}`).join("\n")] : []),
    `${button}: ${appLink}`,
    footer,
  ].join("\n\n");

  const para = (s: string) => `<tr><td style="padding:0 32px 16px;font:400 16px/24px ${FONT};color:${TEXT}">${esc(s)}</td></tr>`;
  const stepsHtml = steps.length
    ? `<tr><td style="padding:0 32px 20px"><ol style="margin:0;padding:0 0 0 20px;font:400 16px/24px ${FONT};color:${TEXT}">${steps
        .map((x) => `<li style="margin:0 0 4px;padding-left:4px">${esc(x)}</li>`)
        .join("")}</ol></td></tr>`
    : "";
  const token =
    kind === "token" && p.token
      ? `<tr><td style="padding:0 32px 20px"><div style="font:500 17px/24px ${MONO};letter-spacing:0.02em;white-space:nowrap;background:${PAGE};border:1px solid ${LINE};border-radius:12px;padding:16px;text-align:center;color:${INK}">${esc(p.token)}</div></td></tr>`
      : "";

  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(m.subject)}</title></head>
<body style="margin:0;padding:0;background:${PAGE}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAGE};padding:24px 12px">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid ${LINE};border-radius:20px">
<tr><td style="padding:32px 32px 24px">
  <table role="presentation" cellpadding="0" cellspacing="0"><tr>
    <td style="padding-right:8px;vertical-align:middle"><img src="${esc(site)}/email/mark.png" width="24" height="24" alt="" style="display:block;border:0;border-radius:7px"></td>
    <td style="vertical-align:middle;font:600 16px/24px ${FONT};color:${INK};letter-spacing:-0.01em">Constant<span style="font-weight:400">Units</span></td>
  </tr></table>
</td></tr>
<tr><td style="padding:0 32px 20px;font:500 24px/32px ${FONT};color:${INK};letter-spacing:-0.01em">${esc(m.subject)}</td></tr>
${para(hello)}
${paragraphs.map(para).join("\n")}
${stepsHtml}${token}
<tr><td style="padding:4px 32px 32px"><a href="${esc(appLink)}" style="display:inline-block;background:${INK};color:#ffffff;text-decoration:none;font:500 15px/20px ${FONT};padding:12px 24px;border-radius:999px">${esc(button)}</a></td></tr>
<tr><td style="padding:20px 32px 24px;border-top:1px solid ${LINE};font:400 12px/20px ${FONT};color:${MUTED}">${esc(footer)}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  return { subject: m.subject, text, html };
}
