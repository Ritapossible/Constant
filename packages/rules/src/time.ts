/**
 * Calendar maths in the site's own time zone, with no dependencies.
 *
 * Every target market today (Africa/Lagos, Africa/Accra, Africa/Nairobi,
 * Africa/Johannesburg) has a fixed offset and no daylight saving, but nothing
 * here assumes that: offsets are read from Intl for the instant in question.
 */
import type { Schedule, Weekday } from "./types.js";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

export interface LocalDate {
  year: number;
  /** 1-12 */
  month: number;
  /** 1-31 */
  day: number;
}

export interface LocalParts extends LocalDate {
  hour: number;
  minute: number;
  weekday: Weekday;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
      weekday: "short",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

const WEEKDAY_BY_NAME: Record<string, Weekday> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

/** Wall-clock parts of `instant` as seen in `timeZone`. */
export function localParts(instant: Date, timeZone: string): LocalParts & { second: number } {
  const out: Record<string, string> = {};
  for (const p of formatter(timeZone).formatToParts(instant)) out[p.type] = p.value;
  const weekday = WEEKDAY_BY_NAME[out.weekday ?? ""];
  if (!weekday) throw new Error(`time: cannot read weekday for zone ${timeZone}`);
  return {
    year: Number(out.year),
    month: Number(out.month),
    day: Number(out.day),
    hour: Number(out.hour),
    minute: Number(out.minute),
    second: Number(out.second),
    weekday,
  };
}

/** Offset of `timeZone` from UTC at `instant`, in ms (Lagos = +3_600_000). */
function offsetMs(instant: Date, timeZone: string): number {
  const p = localParts(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** The instant at which the wall clock in `timeZone` reads `date` + `minuteOfDay`. */
export function zonedInstant(date: LocalDate, minuteOfDay: number, timeZone: string): Date {
  const wall = Date.UTC(date.year, date.month - 1, date.day, 0, minuteOfDay);
  const first = offsetMs(new Date(wall), timeZone);
  let t = wall - first;
  const second = offsetMs(new Date(t), timeZone);
  if (second !== first) t = wall - second;
  return new Date(t);
}

/** Civil-calendar date arithmetic; independent of any zone. */
export function addDays(date: LocalDate, days: number): LocalDate {
  const d = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

function weekdayOf(date: LocalDate): Weekday {
  const js = new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay(); // 0 = Sunday
  return (js === 0 ? 7 : js) as Weekday;
}

export function localDate(instant: Date, timeZone: string): LocalDate {
  const { year, month, day } = localParts(instant, timeZone);
  return { year, month, day };
}

export function sameLocalDate(a: Date, b: Date, timeZone: string): boolean {
  const x = localDate(a, timeZone);
  const y = localDate(b, timeZone);
  return x.year === y.year && x.month === y.month && x.day === y.day;
}

export function assertValidSchedule(s: Schedule): void {
  if (s.weekdays.length === 0) throw new Error("schedule: at least one weekday is required");
  if (!Number.isInteger(s.runMinuteLocal) || s.runMinuteLocal < 0 || s.runMinuteLocal >= 24 * 60) {
    throw new Error("schedule: runMinuteLocal must be an integer in [0, 1440)");
  }
}

/**
 * The first scheduled slot strictly after `after`.
 * Never returns a slot in the past, so a worker that was down does not catch up.
 */
export function nextSlotAfter(after: Date, schedule: Schedule): Date {
  assertValidSchedule(schedule);
  const days = new Set<Weekday>(schedule.weekdays);
  const start = localDate(after, schedule.timeZone);
  for (let k = 0; k <= 7; k++) {
    const date = addDays(start, k);
    if (!days.has(weekdayOf(date))) continue;
    const slot = zonedInstant(date, schedule.runMinuteLocal, schedule.timeZone);
    if (slot.getTime() > after.getTime()) return slot;
  }
  throw new Error("schedule: no slot found in 8 days"); // unreachable with a valid schedule
}

/**
 * Where next_run_at goes after a buy (scheduled or LOW) at `buyAt`.
 *
 * The next chosen morning after the buy's local day, pushed further out if it
 * would fall inside the minimum gap. Without the second condition a LOW on
 * Sunday afternoon would make Monday 07:00 "too soon" and the owner would lose
 * Monday silently.
 */
export function nextRunAfterBuy(buyAt: Date, schedule: Schedule, minHoursBetweenBuys: number): Date {
  const tomorrow = addDays(localDate(buyAt, schedule.timeZone), 1);
  const endOfBuyDay = new Date(zonedInstant(tomorrow, 0, schedule.timeZone).getTime() - 1);
  const earliest = buyAt.getTime() + minHoursBetweenBuys * HOUR_MS;
  let slot = nextSlotAfter(endOfBuyDay, schedule);
  while (slot.getTime() < earliest) slot = nextSlotAfter(slot, schedule);
  return slot;
}

/** Local Monday 00:00 of the week containing `now`. The weekly cap resets here. */
export function weekStart(now: Date, timeZone: string): Date {
  const p = localParts(now, timeZone);
  const monday = addDays({ year: p.year, month: p.month, day: p.day }, 1 - p.weekday);
  return zonedInstant(monday, 0, timeZone);
}

export function hoursBetween(earlier: Date, later: Date): number {
  return (later.getTime() - earlier.getTime()) / HOUR_MS;
}

export { DAY_MS, HOUR_MS };
