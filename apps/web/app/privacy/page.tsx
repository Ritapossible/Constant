import type { Metadata } from "next";
import { Footer } from "@/components/Footer";
import { LegalContact } from "@/components/LegalFooterNote";
import { PageHeader } from "@/components/PageHeader";
import { LEGAL_UPDATED, NOT_USED, SERVICES } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Privacy policy | ConstantUnits",
  description: "What ConstantUnits collects, which services receive it, how long it is kept, and how to delete your account.",
  alternates: { canonical: "/privacy" },
};

export default function Privacy() {
  return (
    <>
      <PageHeader />
      <main id="main" className="container section" style={{ maxWidth: 820 }}>
        <article className="prose">
          <h1 className="h2">Privacy policy</h1>
          <p className="muted">Last updated {LEGAL_UPDATED}</p>
          <p className="lede">
            ConstantUnits keeps your bills paid. To do that it needs a few details about you and your bills. This page says what they
            are, who else handles them, and how to have them deleted. We follow the Nigeria Data Protection Act 2023.
          </p>

          <h2>What we collect</h2>
          <ul>
            <li>
              <b>Your account:</b> the email address, Google name and email, or wallet address you sign in with, the name you ask us to call
              you, and how you want messages (email, SMS).
            </li>
            <li>
              <b>Your bills:</b> the phone, meter and smartcard numbers, the provider, amounts, the day each bill is paid, your limits, and
              readings you log. Phone, meter and smartcard numbers and electricity tokens are stored encrypted.
            </li>
            <li>
              <b>Your money:</b> your ConstantUnits account number, top-ups, payments, fees and receipts. If you ask us to return money, the
              bank account it goes to.
            </li>
            <li>
              <b>Stablecoins, if you use them:</b> your wallet addresses, deposits to them, and the spending permissions you sign.
            </li>
            <li>
              <b>Security:</b> when and on which kind of device you signed in, so you can see your devices and so old sessions can be ended.
            </li>
          </ul>
          <p>{NOT_USED}</p>

          <h2>Why we use it</h2>
          <ul>
            <li>To sign you in and keep your account secure.</li>
            <li>To pay the bills you set up, at the amounts and times you chose, and send you receipts, tokens and warnings.</li>
            <li>To keep accurate financial records and prevent fraud, as Nigerian law requires of payment services.</li>
            <li>To answer you when you write to us.</li>
          </ul>
          <p>
            We use your details because you asked us to provide the service (a contract with you), because the law requires some records,
            and to keep the service safe. We don&apos;t use them for advertising.
          </p>

          <h2>Who else handles your data</h2>
          <p>Only these services receive personal data, and only what each needs to do its part:</p>
          <div className="legal-table" role="table" aria-label="Services that receive personal data">
            {SERVICES.map((s) => (
              <div className="legal-row" role="row" key={s.name}>
                <div role="cell">
                  <b>{s.name}</b>
                  <small>{s.where}</small>
                </div>
                <div role="cell">
                  <span>{s.why}</span>
                  <small>{s.data}</small>
                </div>
              </div>
            ))}
          </div>
          <p>
            We also share information when the law requires it, for example with regulators or law enforcement acting under a valid legal
            order.
          </p>

          <h2>Data outside Nigeria</h2>
          <p>
            Some of these services store or process data in the United States and Germany. We use providers that protect it with security
            and contractual safeguards, as the Nigeria Data Protection Act allows.
          </p>

          <h2>Cookies and storage on your device</h2>
          <p>
            We use only what the app needs to work: your sign-in session (set by Privy), the time you last used the app, so you are
            signed out after a week without use, and, if you used the early preview, bills saved on your phone until they move to your
            account. There are no advertising or analytics cookies, so there is nothing to opt in to.
          </p>

          <h2>How long we keep it</h2>
          <ul>
            <li>Your account and bills: while your account is open.</li>
            <li>
              When you close your account: your contact details, bill numbers, readings, bank details, wallet addresses and sign-in are
              erased straight away.
            </li>
            <li>
              Financial records (amounts, dates, references and receipts) are kept for at least five years after the account closes, as
              Nigerian anti-money-laundering law requires, without your contact details.
            </li>
            <li>Server logs: for a short period set by our hosting providers.</li>
          </ul>

          <h2>Your rights</h2>
          <p>You can ask us to:</p>
          <ul>
            <li>show you the personal data we hold about you, or give you a copy;</li>
            <li>correct it;</li>
            <li>delete it (you can close your account yourself in the app, under Account);</li>
            <li>stop or limit how we use it, where the law allows.</li>
          </ul>
          <p>
            Write to us and we will act within 30 days. You can also download your bills from the app at any time (Account, then Download
            my bills). If you are not satisfied with our answer, you can complain to the Nigeria Data Protection Commission (ndpc.gov.ng).
          </p>

          <h2>Security</h2>
          <p>
            Data travels encrypted. Phone, meter and smartcard numbers and electricity tokens are encrypted in our database. Sessions end
            after 7 days without use and after 30 days in any case, and you can sign out of every device from the app. Your naira is held
            by a licensed payment partner; stablecoins stay in your own wallet, which only you control. We never ask for your password,
            PIN or private key.
          </p>

          <h2>Children</h2>
          <p>ConstantUnits is for people aged 18 and over. We don&apos;t knowingly collect data from children.</p>

          <h2>Changes</h2>
          <p>
            If we change this policy in a way that matters, we will tell you in the app or by message before the change applies. The date at
            the top shows the latest version.
          </p>

          <LegalContact />
        </article>
      </main>
      <Footer base="/" />
    </>
  );
}
