/** What a person can keep paid, and who provides it. Utilities are data, not code (D-038). */

export type Kind = "data" | "airtime" | "electricity" | "tv" | "subscription";

export type Provider = { id: string; name: string; available: boolean };

export const KINDS: { kind: Kind; label: string; hint: string }[] = [
  { kind: "data", label: "Mobile data", hint: "Tops up at your line" },
  { kind: "airtime", label: "Airtime", hint: "Tops up at your line" },
  { kind: "electricity", label: "Electricity", hint: "Prepaid meter tokens" },
  { kind: "tv", label: "Cable TV", hint: "Renews before expiry" },
  { kind: "subscription", label: "Subscription", hint: "AI tools, music, streaming" },
];

const NETWORKS: Provider[] = [
  { id: "mtn", name: "MTN", available: true },
  { id: "airtel", name: "Airtel", available: true },
  { id: "glo", name: "Glo", available: true },
  { id: "9mobile", name: "9mobile", available: true },
];

export const PROVIDERS: Record<Kind, Provider[]> = {
  data: NETWORKS,
  airtime: NETWORKS,
  electricity: [
    { id: "ikedc", name: "IKEDC", available: true },
    { id: "ekedc", name: "EKEDC", available: true },
    { id: "eedc", name: "EEDC", available: true },
    { id: "aedc", name: "AEDC", available: true },
    { id: "ibedc", name: "IBEDC", available: false },
    { id: "phed", name: "PHED", available: false },
    { id: "bedc", name: "BEDC", available: false },
    { id: "kedco", name: "KEDCO", available: false },
    { id: "kaedco", name: "KAEDCO", available: false },
    { id: "jed", name: "JED", available: false },
    { id: "yedc", name: "YEDC", available: false },
    { id: "aba", name: "Aba Power", available: false },
  ],
  tv: [
    { id: "dstv", name: "DSTV", available: true },
    { id: "gotv", name: "GOtv", available: true },
    { id: "startimes", name: "StarTimes", available: true },
  ],
  subscription: [
    { id: "chatgpt", name: "ChatGPT", available: true },
    { id: "claude", name: "Claude", available: true },
    { id: "gemini", name: "Gemini", available: true },
    { id: "spotify", name: "Spotify", available: true },
    { id: "netflix", name: "Netflix", available: true },
  ],
};

/** How each kind is triggered: a usage line (reading at or below the line) or a date. */
export function isUsageKind(k: Kind): boolean {
  return k === "data" || k === "airtime" || k === "electricity";
}

export const UNIT: Record<Kind, string> = {
  data: "MB",
  airtime: "₦",
  electricity: "kWh",
  tv: "",
  subscription: "",
};

export const REF_LABEL: Record<Kind, string> = {
  data: "Phone number",
  airtime: "Phone number",
  electricity: "Meter number",
  tv: "Smartcard / IUC number",
  subscription: "Account email",
};

/** Basic shape checks. The real check is the partner lookup before anything is paid. */
export function validateRef(kind: Kind, raw: string): string | null {
  const v = raw.replace(/[\s-]/g, "");
  if (kind === "data" || kind === "airtime") {
    return /^(\+?234|0)[789]\d{9}$/.test(v) ? null : "Enter a Nigerian number, e.g. 0803 123 4567";
  }
  if (kind === "electricity") return /^\d{11,13}$/.test(v) ? null : "Meter numbers are 11 to 13 digits";
  if (kind === "tv") return /^\d{10,12}$/.test(v) ? null : "Smartcard numbers are 10 to 12 digits";
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(raw.trim()) ? null : "Enter the email on that account";
}

export function maskRef(kind: Kind, ref: string): string {
  if (kind === "subscription") {
    const [u, d] = ref.split("@");
    return `${(u ?? "").slice(0, 2)}•••@${d ?? ""}`;
  }
  return `•••• ${ref.replace(/\D/g, "").slice(-4)}`;
}
