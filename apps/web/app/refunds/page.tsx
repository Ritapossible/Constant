import type { Metadata } from "next";
import { Footer } from "@/components/Footer";
import { LegalContact } from "@/components/LegalFooterNote";
import { PageHeader } from "@/components/PageHeader";
import { LEGAL_UPDATED } from "@/lib/legal";
import { CONTACT_EMAIL } from "@/lib/site";

export const metadata: Metadata = {
  title: "Refund policy | ConstantUnits",
  description: "When ConstantUnits refunds you: undelivered bills, reversed payments, failed top-ups and unused money.",
  alternates: { canonical: "/refunds" },
};

export default function Refunds() {
  return (
    <>
      <PageHeader />
      <main id="main" className="container section" style={{ maxWidth: 820 }}>
        <article className="prose">
          <h1 className="h2">Refund policy</h1>
          <p className="muted">Last updated {LEGAL_UPDATED}</p>
          <p className="lede">The short version: you pay only for bills that are delivered. If something isn&apos;t delivered, the money is yours again, fee included.</p>

          <h2>A bill that isn&apos;t delivered</h2>
          <p>
            If a payment fails, nothing is taken: the amount and the fee stay in your ConstantUnits balance, automatically. If a provider
            reverses a payment after it went through, we put the amount and its fee back in your balance and tell you.
          </p>

          <h2>A bill that was delivered</h2>
          <p>
            Airtime, data, electricity tokens and TV renewals are used up by the provider the moment they are delivered, so a delivered
            payment can&apos;t be reversed. If it went to a wrong number you entered, write to us straight away: we will ask the provider, but
            we can&apos;t promise they will return it.
          </p>

          <h2>Electricity token not received</h2>
          <p>
            Every token is in the app (open the bill to see the latest one) as well as in your message. If you can&apos;t find it, or the meter
            rejects it, write to us with the bill name. We check with the electricity company and either send you the right token or refund
            the payment and its fee.
          </p>

          <h2>Card, USSD and QR top-ups</h2>
          <ul>
            <li>The card fee shown before you pay belongs to the payment processor (Paystack) and is passed on at cost.</li>
            <li>If a top-up fails but your bank took the money, your bank returns it, usually within a few working days.</li>
            <li>If you were charged twice for one top-up, we refund the extra charge in full, fee included.</li>
          </ul>

          <h2>Unused money in your balance</h2>
          <p>
            Your balance never expires. If you close your account, or ask us to, we return unused money to a Nigerian bank account in your
            own name, after checking it is you. We send it within 5 business days of confirming the details.
          </p>

          <h2>Stablecoins</h2>
          <p>
            Stablecoins stay in your wallet until a bill is paid with them. If we charge a bill and it then isn&apos;t delivered, the naira
            value is added to your ConstantUnits balance, and can be returned to your bank as above. Blockchain payments themselves can&apos;t
            be reversed.
          </p>

          <h2>How to ask</h2>
          <p>
            Write to <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> from the email on your account, with the bill name, the date and
            the amount (the receipt link in your message has all three). We reply within two business days and resolve most requests within
            10 business days.
          </p>

          <LegalContact />
        </article>
      </main>
      <Footer base="/" />
    </>
  );
}
