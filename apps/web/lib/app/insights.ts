/**
 * Everything the app says about a line comes from packages/rules: forecasts,
 * confidence wording, reminders. No numbers are invented in the UI.
 */
import {
  DEFAULT_REMINDER_POLICY,
  addDays,
  decideLowReminder,
  lightForecastMode,
  localDate,
  runOutWindow,
  usageStats,
  zonedInstant,
  type UsageStats,
} from "@constant/rules";
import { isUsageKind } from "./catalog";
import type { Line, Reading } from "./store";

const TZ = "Africa/Lagos";
const DAY = 86_400_000;

/** Usage per day between consecutive readings. Rises (top-ups) are skipped. */
export function dailyRates(readings: readonly Reading[]): number[] {
  const rs = [...readings].sort((a, b) => +new Date(a.at) - +new Date(b.at));
  const out: number[] = [];
  for (let i = 1; i < rs.length; i++) {
    const a = rs[i - 1]!;
    const b = rs[i]!;
    const days = (+new Date(b.at) - +new Date(a.at)) / DAY;
    if (days < 0.25 || b.value > a.value) continue;
    out.push((a.value - b.value) / days);
  }
  return out;
}

export function latest(readings: readonly Reading[]): Reading | null {
  if (readings.length === 0) return null;
  return [...readings].sort((a, b) => +new Date(b.at) - +new Date(a.at))[0] ?? null;
}

/** Next renewal for a date line: this month's day if still ahead, else next month's. */
export function nextRenewal(renewDay: number, now: Date): Date {
  const today = localDate(now, TZ);
  const at = (y: number, m: number) => zonedInstant({ year: y, month: m, day: renewDay }, 9 * 60, TZ);
  const thisMonth = at(today.year, today.month);
  if (thisMonth.getTime() > now.getTime()) return thisMonth;
  const nm = addDays({ year: today.year, month: today.month, day: 1 }, 32);
  return at(nm.year, nm.month);
}

export type Outlook =
  | { kind: "renewal"; date: Date }
  | { kind: "needs_reading" }
  | { kind: "learning"; remaining: number }
  | { kind: "forecast"; remaining: number; early: Date; likely: Date; confident: boolean }
  | { kind: "steady"; remaining: number };

export function outlook(line: Line, now: Date): Outlook {
  if (!isUsageKind(line.kind)) return { kind: "renewal", date: nextRenewal(line.renewDay ?? 1, now) };
  const last = latest(line.readings);
  if (!last) return { kind: "needs_reading" };
  const stats: UsageStats | null = usageStats(dailyRates(line.readings));
  const span = line.readings.length > 1 ? (+new Date(last.at) - Math.min(...line.readings.map((r) => +new Date(r.at)))) / DAY : 0;
  const lightMode = line.kind === "electricity" ? lightForecastMode(line.readings.length, span) : null;
  if (!stats || lightMode === "learning") return { kind: "learning", remaining: last.value };
  const toLine = Math.max(0, last.value - (line.threshold ?? 0));
  const w = runOutWindow(toLine, stats, now);
  if (!w) return { kind: "steady", remaining: last.value };
  return { kind: "forecast", remaining: last.value, early: w.early, likely: w.likely, confident: lightMode !== "rough" };
}

export type Notice = { lineId: string; tone: "act" | "info"; title: string; body: string };

/** Heads-ups for the home screen, using the same reminder policy as production (D-042). */
export function notices(lines: readonly Line[], now: Date): Notice[] {
  const out: Notice[] = [];
  const policy = { ...DEFAULT_REMINDER_POLICY, timeZone: TZ, quietStartMinuteLocal: 0, quietEndMinuteLocal: 0 };
  for (const line of lines) {
    if (line.status !== "active") continue;
    const name = line.nickname;
    if (!isUsageKind(line.kind)) {
      const date = nextRenewal(line.renewDay ?? 1, now);
      const days = Math.ceil((date.getTime() - now.getTime()) / DAY);
      if (days <= 3) out.push({ lineId: line.id, tone: "info", title: `${name} renews in ${days <= 1 ? "a day" : `${days} days`}`, body: "Make sure its pot covers it." });
      continue;
    }
    const last = latest(line.readings);
    if (!last) {
      out.push({ lineId: line.id, tone: "info", title: `Add a reading for ${name}`, body: "One reading starts the forecast." });
      continue;
    }
    if (line.threshold !== undefined && last.value <= line.threshold) {
      out.push({ lineId: line.id, tone: "act", title: `${name} is at your line`, body: "This is when Constant tops it up." });
      continue;
    }
    const d = decideLowReminder({
      remaining: Math.max(0, last.value - (line.threshold ?? 0)),
      stats: usageStats(dailyRates(line.readings)),
      coveredByAutopilot: false,
      lastReminderAt: null,
      now,
      policy,
    });
    if (d.kind === "remind") {
      out.push({
        lineId: line.id,
        tone: "act",
        title: `${name} likely low within 48 hours`,
        body: line.kind === "electricity" ? "Send a meter photo or reading to check." : "Top up now, or let autopilot do it.",
      });
    }
  }
  return out;
}
