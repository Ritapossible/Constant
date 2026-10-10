import { localParts } from "@constant/rules";
import type { CablePlan, CableProvider, CableVending, DecoderLookup, VendOutcome } from "./types.js";

/**
 * In-memory cable partner for tests and local dev. Scripted outcomes let tests walk every path:
 * delivered, pending then delivered, failed, timeout, crash, reversal.
 */
export class FakeCableVending implements CableVending {
  readonly name = "fake";
  decoders = new Map<string, { customerName: string; plan: string; renewalAmountMinor: bigint; dueAt: Date | null }>();
  /** Outcomes returned by successive renew calls; when empty, renew delivers. */
  renewScript: (VendOutcome | "throw")[] = [];
  /** Outcomes returned by successive requery calls; when empty, requery echoes the last known state. */
  requeryScript: VendOutcome[] = [];
  lookupUnreachable = false;
  readonly calls: { renew: { requestId: string; smartcard: string; amountMinor: bigint }[]; requery: string[] } = { renew: [], requery: [] };
  private readonly state = new Map<string, VendOutcome>();

  /** Local dev: a few decoders that look up, ending tomorrow, so a renewal runs straight away. */
  static withDemoDecoders(now = new Date()): FakeCableVending {
    const v = new FakeCableVending();
    const due = new Date(now.getTime() + 86_400_000);
    v.decoders.set("7012345678", { customerName: "ADA OBI", plan: "DStv Compact", renewalAmountMinor: 1_995_000n, dueAt: due });
    v.decoders.set("2012345678", { customerName: "TUNDE BELLO", plan: "GOtv Max", renewalAmountMinor: 850_000n, dueAt: due });
    v.decoders.set("01234567890", { customerName: "CHIOMA EZE", plan: "Nova", renewalAmountMinor: 190_000n, dueAt: null });
    return v;
  }

  async plans(_provider: CableProvider): Promise<CablePlan[]> {
    return [
      { code: "compact", name: "Compact", amountMinor: 1_995_000n },
      { code: "padi", name: "Padi", amountMinor: 440_000n },
    ];
  }

  async lookup(_provider: CableProvider, smartcard: string): Promise<DecoderLookup> {
    if (this.lookupUnreachable) return { ok: false, reason: "unreachable" };
    const d = this.decoders.get(smartcard);
    if (!d) return { ok: false, reason: "not_found" };
    return { ok: true, customerName: d.customerName, currentPlan: d.plan, renewalAmountMinor: d.renewalAmountMinor, dueAt: d.dueAt };
  }

  async renew(req: { requestId: string; provider: CableProvider; smartcard: string; amountMinor: bigint; phone: string }): Promise<VendOutcome> {
    this.calls.renew.push({ requestId: req.requestId, smartcard: req.smartcard, amountMinor: req.amountMinor });
    const next = this.renewScript.shift() ?? { kind: "delivered", partnerTxnId: `T${this.calls.renew.length}` };
    if (next === "throw") {
      // The partner received it (and will deliver), but our process died before reading the reply.
      this.state.set(req.requestId, { kind: "delivered", partnerTxnId: "T-crash" });
      throw new Error("simulated crash after send");
    }
    this.state.set(req.requestId, next);
    if (next.kind === "delivered") {
      const d = this.decoders.get(req.smartcard);
      if (d?.dueAt) d.dueAt = new Date(d.dueAt.getTime() + 30 * 86_400_000);
    }
    return next;
  }

  async requery(requestId: string): Promise<VendOutcome> {
    this.calls.requery.push(requestId);
    const scripted = this.requeryScript.shift();
    if (scripted) {
      this.state.set(requestId, scripted);
      return scripted;
    }
    return this.state.get(requestId) ?? { kind: "not_found" };
  }

  newRequestId(orderId: string, now: Date): string {
    const p = localParts(now, "Africa/Lagos");
    return `${p.year}${String(p.month).padStart(2, "0")}${String(p.day).padStart(2, "0")}${orderId.replace(/-/g, "").slice(0, 20)}`;
  }

  webhookRequestId(rawBody: string): string | null {
    try {
      const b = JSON.parse(rawBody) as { data?: { requestId?: string } };
      return b.data?.requestId ?? null;
    } catch {
      return null;
    }
  }
}
