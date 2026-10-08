/** Money is bigint minor units (kobo, cents), stored as strings. Never floats. */

export type Currency = "NGN" | "USD";

export function toMinor(input: string): bigint | null {
  const v = input.replace(/[,\s₦$]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(v)) return null;
  const [whole, frac = ""] = v.split(".");
  return BigInt(whole ?? "0") * 100n + BigInt((frac + "00").slice(0, 2));
}

export function formatMoney(minor: bigint, currency: Currency): string {
  const neg = minor < 0n;
  const abs = neg ? -minor : minor;
  const whole = (abs / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const cents = abs % 100n;
  const sym = currency === "NGN" ? "₦" : "$";
  return `${neg ? "-" : ""}${sym}${whole}${cents ? "." + cents.toString().padStart(2, "0") : ""}`;
}

export function formatUnits6(value: bigint): string {
  const whole = value / 1_000_000n;
  const frac = (value % 1_000_000n).toString().padStart(6, "0").slice(0, 2);
  return `${whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${frac}`;
}

const DAY_FMT = new Intl.DateTimeFormat("en-NG", { weekday: "short", day: "numeric", month: "short", timeZone: "Africa/Lagos" });
export const formatDay = (d: Date) => DAY_FMT.format(d);
