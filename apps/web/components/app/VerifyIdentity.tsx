"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { Kyc } from "@/lib/app/api";
import { formatMoney } from "@/lib/app/format";
import { BankPicker, useBanks } from "./BankPicker";
import { Field } from "./Field";
import { useServer } from "./Server";


/**
 * Verifying identity before the account number (D-086): Paystack checks the BVN against a bank account in the
 * person's own name. The BVN goes to Paystack; ConstantUnits keeps only its last 4 digits.
 */
export function VerifyIdentity({ onVerified }: { onVerified: () => void }) {
  const { call } = useServer();
  const [kyc, setKyc] = useState<Kyc | null>(null);
  const banks = useBanks();
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [bvn, setBvn] = useState("");
  const [bank, setBank] = useState("");
  const [account, setAccount] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  const load = useCallback(async () => {
    const k = await call<Kyc>("/v1/kyc");
    setKyc(k);
    setLoadFailed(false);
    if (k.current.accountNumber) onVerified();
    return k;
  }, [call, onVerified]);

  useEffect(() => {
    load().catch(() => setLoadFailed(true));
  }, [load]);

  // While Paystack checks (usually under a minute), look again every few seconds.
  useEffect(() => {
    if (kyc?.check?.status !== "pending") return;
    const t = window.setInterval(() => load().catch(() => undefined), 5_000);
    return () => window.clearInterval(t);
  }, [kyc?.check?.status, load]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const tel = phone.replace(/[\s-]/g, "");
    if (!first.trim() || !last.trim())
      return setFormError(
        "Enter your first and last name as they appear at your bank",
      );
    if (!/^\d{11}$/.test(bvn))
      return setFormError(
        "Your BVN is 11 digits. Dial *565*0# from the phone number linked to it to see it.",
      );
    if (!bank) return setFormError("Type your bank and pick it from the list");
    if (!/^\d{10}$/.test(account))
      return setFormError("Enter your 10-digit account number");
    if (!/^(\+234|0)[789]\d{9}$/.test(tel))
      return setFormError(
        "Enter your Nigerian mobile number, e.g. 0803 123 4567",
      );
    setBusy(true);
    setFormError(null);
    try {
      await call("/v1/kyc/bvn", {
        method: "POST",
        body: {
          firstName: first.trim(),
          lastName: last.trim(),
          bvn,
          bankCode: bank,
          accountNumber: account,
          phone: tel,
        },
      });
      setBvn("");
      await load();
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!kyc && loadFailed) {
    return (
      <div className="ap-inline-state" role="alert">
        <p className="ap-muted">We couldn&apos;t load your verification status.</p>
        <button className="btn btn-primary btn-sm" type="button" onClick={() => load().catch(() => setLoadFailed(true))}>
          Try again
        </button>
      </div>
    );
  }

  if (!kyc) {
    return (
      <div className="ap-inline-state" role="status">
        <span className="ap-spinner" aria-hidden="true" />
        <p className="ap-muted">Loading…</p>
      </div>
    );
  }

  if (kyc.check?.status === "pending") {
    return (
      <div className="ap-inline-state" role="status" aria-live="polite">
        <span className="ap-spinner" aria-hidden="true" />
        <p className="ap-muted">
          Checking your details with your bank. This usually takes under a
          minute; you can leave this page.
        </p>
      </div>
    );
  }

  const verified = kyc.tiers[1]!;
  return (
    <form className="ap-form" onSubmit={submit} noValidate>
      <p className="ap-muted">
        To get your own account number, confirm it&apos;s you. We check your BVN
        against a bank account in your name, the way banks do. It takes a
        minute.
      </p>
      {kyc.check?.status === "failed" && kyc.check.reason && (
        <p className="ap-muted" role="alert">
          {kyc.check.reason}
        </p>
      )}
      <div className="ap-grid-2">
        <Field label="First name">
          {(a) => (
            <input
              {...a}
              autoComplete="given-name"
              value={first}
              onChange={(e) => setFirst(e.target.value)}
            />
          )}
        </Field>
        <Field label="Last name">
          {(a) => (
            <input
              {...a}
              autoComplete="family-name"
              value={last}
              onChange={(e) => setLast(e.target.value)}
            />
          )}
        </Field>
      </div>
      <Field label="BVN">
        {(a) => (
          <input
            {...a}
            inputMode="numeric"
            autoComplete="off"
            maxLength={11}
            value={bvn}
            onChange={(e) => setBvn(e.target.value.replace(/\D/g, ""))}
            placeholder="11 digits"
          />
        )}
      </Field>
      <Field label="Your bank">
        {(a) => <BankPicker id={a.id} list={banks} value={bank} onChange={setBank} invalid={a["aria-invalid"]} {...(a["aria-describedby"] ? { describedBy: a["aria-describedby"] } : {})} />}
      </Field>
      <Field label="Account number in your name">
        {(a) => (
          <input
            {...a}
            inputMode="numeric"
            maxLength={10}
            value={account}
            onChange={(e) => setAccount(e.target.value.replace(/\D/g, ""))}
            placeholder="10 digits"
          />
        )}
      </Field>
      <Field label="Mobile number" error={formError}>
        {(a) => (
          <input
            {...a}
            inputMode="tel"
            autoComplete="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="0803 123 4567"
          />
        )}
      </Field>
      <button className="btn btn-primary" type="submit" disabled={busy}>
        {busy ? "Sending…" : "Verify and get my account number"}
      </button>
      <p className="ap-fine">
        Your BVN goes to our licensed payment partner to confirm it&apos;s you;
        we keep only its last 4 digits. Verified accounts can add up to{" "}
        {formatMoney(BigInt(verified.dailyInMinor), "NGN")} a day and withdraw
        to their own bank.
      </p>
    </form>
  );
}
