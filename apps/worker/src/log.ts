/**
 * JSON lines to stdout. Redacts any run of 10+ digits (smartcards, meters, phones, tokens) in messages
 * and fields (CLAUDE.md rule 9).
 */
export interface Log {
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

export const redact = (s: string) => s.replace(/\d{10,}/g, (m) => `…${m.slice(-4)}`);

const SECRET_FIELD = /token|smartcard|meter|phone|secret|key|password/i;

function line(level: string, msg: string, fields?: Record<string, unknown>): string {
  const safe: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields ?? {})) {
    if (SECRET_FIELD.test(k) && k !== "partnerRef") safe[k] = "[redacted]";
    else safe[k] = typeof v === "string" ? redact(v) : typeof v === "bigint" ? v.toString() : v;
  }
  return JSON.stringify({ t: new Date().toISOString(), level, msg: redact(msg), ...safe });
}

export function jsonLog(service: string): Log {
  return {
    info: (m, f) => console.log(line("info", m, { service, ...f })),
    warn: (m, f) => console.warn(line("warn", m, { service, ...f })),
    error: (m, f) => console.error(line("error", m, { service, ...f })),
  };
}

export const silentLog: Log = { info: () => undefined, warn: () => undefined, error: () => undefined };
