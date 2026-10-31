/**
 * SMS text in the GSM-7 alphabet (INV-24). One character outside it, such as "₦" or "•", makes the whole message
 * UCS-2: 70 characters a part instead of 160, so a 120-character token SMS costs two messages and can arrive in
 * pieces on a basic phone. Messages are written once for every channel; this turns them into GSM-7 for SMS only.
 */

/** The GSM 03.38 basic character set: one unit each. */
const BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
/** The extension table: two units each (an escape, then the character). */
const EXTENDED = "^{}\\[~]|€\f";

/** What our messages use that GSM-7 lacks, written the way Nigerian SMS already writes it. */
const SUBSTITUTE: Record<string, string> = {
  "₦": "N",
  "•": "*",
  "…": "...",
  "‘": "'",
  "’": "'",
  "“": '"',
  "”": '"',
  "–": "-",
  "—": "-",
  " ": " ",
  " ": " ",
  "×": "x",
};

/** The message in GSM-7: known characters substituted, anything else left out. */
export function toSmsText(text: string): string {
  let out = "";
  for (const ch of text) {
    const c = SUBSTITUTE[ch] ?? ch;
    for (const x of c) if (BASIC.includes(x) || EXTENDED.includes(x)) out += x;
  }
  return out;
}

export function isGsm7(text: string): boolean {
  for (const ch of text) if (!BASIC.includes(ch) && !EXTENDED.includes(ch)) return false;
  return true;
}

/** How many SMS a text costs: 160 units in one, 153 a part when split; 70 and 67 if any character isn't GSM-7. */
export function smsParts(text: string): number {
  if (isGsm7(text)) {
    let units = 0;
    for (const ch of text) units += EXTENDED.includes(ch) ? 2 : 1;
    return units <= 160 ? 1 : Math.ceil(units / 153);
  }
  const n = [...text].length;
  return n <= 70 ? 1 : Math.ceil(n / 67);
}
