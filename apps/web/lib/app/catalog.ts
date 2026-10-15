/** What a person can keep paid, and who provides it. Utilities are data, not code (D-038). */

export type Kind = "data" | "airtime" | "electricity" | "tv" | "subscription";

export type Provider = {
  id: string;
  /** Short name for tiles and lists, e.g. "Ikeja". */
  name: string;
  /** Full name, e.g. "Ikeja Electric (IKEDC)". */
  full?: string;
  /**
   * Has a logo at /providers/{id}.{ext}: `true` is a .jpg from the vend partner's catalogue (VTpass); a string is
   * the extension of one taken from the provider's own website.
   */
  logo?: true | "png" | "svg";
  available: boolean;
};

export const KINDS: { kind: Kind; label: string; hint: string }[] = [
  { kind: "data", label: "Mobile data", hint: "Tops up at your line" },
  { kind: "airtime", label: "Airtime", hint: "Tops up at your line" },
  { kind: "electricity", label: "Electricity", hint: "Prepaid meter tokens" },
  { kind: "tv", label: "Cable TV", hint: "Renews before expiry" },
  { kind: "subscription", label: "Subscription", hint: "AI tools, music, streaming" },
];

const NETWORKS: Provider[] = [
  { id: "mtn", name: "MTN", logo: true, available: true },
  { id: "airtel", name: "Airtel", logo: true, available: true },
  { id: "glo", name: "Glo", logo: true, available: true },
  // 9mobile trades as T2 since 2025; the id stays so saved bills keep working.
  { id: "9mobile", name: "T2", full: "T2 (formerly 9mobile)", logo: true, available: true },
];

export const PROVIDERS: Record<Kind, Provider[]> = {
  data: NETWORKS,
  airtime: NETWORKS,
  electricity: [
    { id: "ikedc", name: "Ikeja", full: "Ikeja Electric (IKEDC)", logo: true, available: true },
    { id: "ekedc", name: "Eko", full: "Eko Electricity (EKEDC)", logo: true, available: true },
    { id: "aedc", name: "Abuja", full: "Abuja Electricity (AEDC)", logo: true, available: true },
    { id: "eedc", name: "Enugu", full: "Enugu Electricity (EEDC)", logo: true, available: true },
    { id: "ibedc", name: "Ibadan", full: "Ibadan Electricity (IBEDC)", logo: true, available: false },
    { id: "phed", name: "Port Harcourt", full: "Port Harcourt Electricity (PHED)", logo: true, available: false },
    { id: "bedc", name: "Benin", full: "Benin Electricity (BEDC)", logo: true, available: false },
    { id: "kedco", name: "Kano", full: "Kano Electricity (KEDCO)", logo: true, available: false },
    { id: "kaedco", name: "Kaduna", full: "Kaduna Electric (KAEDCO)", logo: true, available: false },
    { id: "jed", name: "Jos", full: "Jos Electricity (JED)", logo: true, available: false },
    { id: "yedc", name: "Yola", full: "Yola Electricity (YEDC)", logo: true, available: false },
    // Aba Power trades as APL Electric.
    { id: "aba", name: "Aba", full: "APL Electric (Aba Power)", logo: true, available: false },
  ],
  tv: [
    { id: "dstv", name: "DStv", logo: true, available: true },
    { id: "gotv", name: "GOtv", logo: true, available: true },
    { id: "startimes", name: "StarTimes", logo: true, available: true },
  ],
  subscription: [
    // Logos from each service's own site, unaltered: status.openai.com (chatgpt.com blocks automated requests),
    // claude.ai, gemini.google.com, Spotify's web-player manifest, and the "N" vector from netflix.com on black.
    { id: "chatgpt", name: "ChatGPT", full: "ChatGPT (OpenAI)", logo: "png", available: true },
    { id: "claude", name: "Claude", full: "Claude (Anthropic)", logo: "png", available: true },
    { id: "gemini", name: "Gemini", full: "Gemini (Google)", logo: "png", available: true },
    { id: "spotify", name: "Spotify", logo: "png", available: true },
    { id: "netflix", name: "Netflix", logo: "svg", available: true },
  ],
};

/** How each kind is triggered: a usage line (reading at or below the line) or a date. */
export function isUsageKind(k: Kind): boolean {
  return k === "data" || k === "airtime" || k === "electricity";
}

/** A bill tops up on usage, except a postpaid meter, which is a monthly bill paid on a day. */
export function isUsageLine(l: { kind: Kind; meterType?: "prepaid" | "postpaid" }): boolean {
  return isUsageKind(l.kind) && !(l.kind === "electricity" && l.meterType === "postpaid");
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

/** Where a provider's logo is, if it has one. */
export const logoOf = (p: Pick<Provider, "id" | "logo"> | undefined) => (p?.logo ? `/providers/${p.id}.${p.logo === true ? "jpg" : p.logo}` : null);

export const findProvider = (kind: Kind, id: string) => PROVIDERS[kind].find((p) => p.id === id);

/**
 * The network a Nigerian number was issued on, from its prefix (NCC allocations). Only a suggestion: a ported
 * number keeps its prefix, so the person can always change it.
 */
const PREFIXES: Record<string, string[]> = {
  mtn: ["0703", "0704", "0706", "0707", "0803", "0806", "0810", "0813", "0814", "0816", "0903", "0906", "0913", "0916"],
  airtel: ["0701", "0708", "0802", "0808", "0812", "0901", "0902", "0904", "0907", "0911", "0912"],
  glo: ["0705", "0805", "0807", "0811", "0815", "0905", "0915"],
  "9mobile": ["0809", "0817", "0818", "0908", "0909"],
};
export function networkFor(raw: string): string | null {
  let v = raw.replace(/[\s-]/g, "");
  if (v.startsWith("+234")) v = "0" + v.slice(4);
  else if (v.startsWith("234")) v = "0" + v.slice(3);
  if (v.length < 4) return null;
  const p = v.slice(0, 4);
  return Object.keys(PREFIXES).find((k) => PREFIXES[k]!.includes(p)) ?? null;
}

/** Quick picks for "each top-up", in naira. */
export const QUICK_AMOUNTS: Partial<Record<Kind, number[]>> = {
  airtime: [100, 200, 500, 1000, 2000, 5000],
  data: [500, 1000, 2000, 3500, 5000, 10000],
  electricity: [2000, 5000, 10000, 15000, 20000, 50000],
};

export type MeterType = "prepaid" | "postpaid";
