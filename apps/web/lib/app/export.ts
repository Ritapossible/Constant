import type { ServerLine } from "./api";
import { KINDS, UNIT, findProvider, isUsageLine } from "./catalog";
import { formatMoney } from "./format";
import type { Plan } from "./store";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const day = (iso: string) => new Date(iso).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" });
const TV: Record<string, string> = { dstv: "DStv", gotv: "GOtv", startimes: "StarTimes" };

type Row = { bill: string; provider: string; ref: string; amount: string; when: string; limit: string; status: string; added: string };

/**
 * "Download my bills": a readable page a person can open on any phone, print or save as PDF. Not a data file.
 * Their own bills, so numbers are shown in full; nothing is sent anywhere, it's built on the device.
 */
export function billsDocument(plan: Plan, server: ServerLine[], name: string | null, now = new Date()): string {
  const rows: Row[] = [
    ...plan.lines.map((l) => {
      const p = findProvider(l.kind, l.provider);
      const usage = isUsageLine(l);
      return {
        bill: `${l.nickname} (${KINDS.find((k) => k.kind === l.kind)?.label ?? l.kind})`,
        provider: p?.full ?? p?.name ?? l.provider,
        ref: l.ref,
        amount: formatMoney(BigInt(l.amountMinor), l.currency),
        when: usage ? `When it's down to ${l.threshold ?? "?"}${UNIT[l.kind] ? " " + UNIT[l.kind] : ""}` : `Day ${l.renewDay ?? "?"} of each month`,
        limit: `${formatMoney(BigInt(l.weeklyCapMinor), l.currency)} a week`,
        status: l.status === "active" ? "On" : "Paused",
        added: day(l.createdAt),
      };
    }),
    ...server
      .filter((l) => l.status !== "cancelled")
      .map((l) => ({
        bill: `${l.nickname} (TV)`,
        provider: TV[l.provider] ?? l.provider,
        ref: `ending ${l.last4}`,
        amount: l.planName ?? "Your plan",
        when: l.nextRunAt ? `Next renewal ${day(l.nextRunAt)}` : "The day before it ends",
        limit: `Up to ${formatMoney(BigInt(l.capMinor), "NGN")} each time`,
        status: l.status === "active" ? "On" : l.status === "frozen" ? "Needs attention" : "Paused",
        added: "",
      })),
  ];
  const body = rows.length
    ? `<table><thead><tr><th>Bill</th><th>Provider</th><th>Number or account</th><th>Amount</th><th>When</th><th>Limit</th><th>Status</th></tr></thead><tbody>${rows
        .map(
          (r) =>
            `<tr><td data-l="Bill"><div><b>${esc(r.bill)}</b>${r.added ? `<small>Added ${esc(r.added)}</small>` : ""}</div></td><td data-l="Provider">${esc(r.provider)}</td><td data-l="Number or account">${esc(r.ref)}</td><td data-l="Amount">${esc(r.amount)}</td><td data-l="When">${esc(r.when)}</td><td data-l="Limit">${esc(r.limit)}</td><td data-l="Status">${esc(r.status)}</td></tr>`,
        )
        .join("")}</tbody></table>`
    : `<p>You have no bills yet.</p>`;
  const names = plan.channels.map((c) => ({ whatsapp: "WhatsApp", telegram: "Telegram", sms: "SMS", email: "email" })[c]);
  const channels = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : (names[0] ?? "");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Your bills · ConstantUnits</title>
<style>
body{margin:0;background:#f6f6f4;color:#0a0a0a;font:15px/1.5 -apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
main{max-width:960px;margin:0 auto;padding:28px 16px 48px}
.brand{font-weight:700;font-size:18px;letter-spacing:-.02em}.brand span{font-weight:400}
h1{font-size:28px;letter-spacing:-.03em;margin:24px 0 4px}p.meta{color:#6b6b66;margin:0 0 20px}
table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #e6e6e1;border-radius:16px;overflow:hidden}
th,td{text-align:left;padding:12px 14px;border-bottom:1px solid #eeeeea;vertical-align:top}
th{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#6b6b66;font-weight:600;background:#fafaf8}
td small{display:block;color:#6b6b66;font-size:12px}
footer{margin-top:24px;color:#6b6b66;font-size:13px}
@media (max-width:640px){thead{display:none}table,tbody,tr,td{display:block}tr{border-bottom:1px solid #e6e6e1;padding:8px 0}
td{border:0;padding:4px 14px;display:flex;gap:12px}td::before{content:attr(data-l);color:#6b6b66;min-width:96px;max-width:96px;font-size:13px}}
@media print{body{background:#fff}main{padding:0}}
</style></head><body><main>
<div class="brand">Constant<span>Units</span></div>
<h1>Your bills</h1>
<p class="meta">${name ? `${esc(name)} · ` : ""}As of ${esc(day(now.toISOString()))}${channels ? ` · Messages by ${esc(channels)}` : ""}</p>
${body}
<footer>Saved from the ConstantUnits app. To print or keep it as a PDF, use your browser's Print or Share menu.</footer>
</main></body></html>`;
}
