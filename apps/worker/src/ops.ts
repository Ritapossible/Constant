/** Emails new ops alerts to the ops inbox (D-065). Pages are the subject line; nothing personal is included. */
import { releaseAlerts, takeUnnotifiedAlerts } from "@constant/db";
import type { Deps } from "./jobs.js";

export async function notifyOps(d: Deps, opsEmail: string | undefined): Promise<number> {
  if (!opsEmail || !d.messaging.channels.includes("email")) return 0;
  const alerts = await takeUnnotifiedAlerts(d.db);
  if (alerts.length === 0) return 0;
  const pages = alerts.filter((a) => a.severity === "page");
  const subject = pages.length ? `PAGE: ${[...new Set(pages.map((a) => a.kind))].join(", ")}` : `Constant: ${alerts.length} warning(s)`;
  const text = alerts
    .map((a) => `#${a.id} ${a.severity.toUpperCase()} ${a.kind} at ${a.created_at.toISOString()}\n${JSON.stringify(a.detail)}`)
    .join("\n\n");
  try {
    await d.messaging.send("email", opsEmail, subject, `${text}\n\nResolve with the ops API: POST /ops/alerts/<id>/resolve`);
    return alerts.length;
  } catch (err) {
    // Not lost: they're released and sent with the next batch.
    await releaseAlerts(d.db, alerts.map((a) => a.id));
    d.log.error("ops alert email failed", { err: (err as Error).message });
    return 0;
  }
}
