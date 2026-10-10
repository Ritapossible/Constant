/** fetch with a timeout. Injected everywhere so tests never touch the network. */
export type Fetch = typeof fetch;

export class HttpTimeout extends Error {}

export async function fetchJson(
  f: Fetch,
  url: string,
  init: RequestInit & { timeoutMs?: number },
): Promise<{ status: number; body: unknown }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), init.timeoutMs ?? 30_000);
  try {
    const res = await f(url, { ...init, signal: ctrl.signal });
    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { nonJson: text.slice(0, 200) };
    }
    return { status: res.status, body };
  } catch (err) {
    if ((err as Error).name === "AbortError") throw new HttpTimeout(`timeout calling ${new URL(url).host}`);
    throw err;
  } finally {
    clearTimeout(t);
  }
}

/** "19,950.00" or 19950 → 1995000n. Exact; never through a float. */
export function nairaToMinor(v: unknown): bigint | null {
  if (typeof v === "number") {
    if (!Number.isFinite(v) || v < 0) return null;
    v = v.toFixed(2);
  }
  if (typeof v !== "string") return null;
  const s = v.replace(/[,\s₦]/g, "");
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  return BigInt(m[1]!) * 100n + BigInt((m[2] ?? "0").padEnd(2, "0"));
}

export function minorToNaira(minor: bigint): string {
  return `${minor / 100n}.${(minor % 100n).toString().padStart(2, "0")}`;
}
