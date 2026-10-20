import type { Metadata } from "next";
import { Footer } from "@/components/Footer";
import { LegalContact } from "@/components/LegalFooterNote";
import { PageHeader } from "@/components/PageHeader";
import { LEGAL_UPDATED } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Terms of service | ConstantUnits",
  description: "The agreement between you and ConstantUnits: how bills are paid, your responsibilities, fees, and the limits of our liability.",
  alternates: { canonical: "/terms" },
};

export default function Terms() {
  return (
    <>
      <PageHeader />
      <main id="main" className="container section" style={{ maxWidth: 820 }}>
        <article className="prose">
          <h1 className="h2">Terms of service</h1>
          <p className="muted">Last updated {LEGAL_UPDATED}</p>
          <p className="lede">
            These terms are the agreement between you and ConstantUnits. By creating an account or using the app, you accept them. Please
            read them with our <a href="/privacy">privacy policy</a> and <a href="/refunds">refund policy</a>.
          </p>

          <h2>1. What ConstantUnits does</h2>
          <p>
            ConstantUnits pays your data, airtime, electricity and cable TV bills automatically, at the amounts and times you choose, and
            warns you before something runs out. It is in early access: features may change, and payments are switched on in stages with
            our licensed partners.
          </p>
          <p>
            ConstantUnits is not a bank and does not lend. Naira you add is held by a licensed payment partner (Paystack). Bills are paid
            through a licensed bill-payment partner (VTpass). The network, electricity company or TV provider is responsible for the service
            itself once it is paid.
          </p>

          <h2>2. Who can use it</h2>
          <p>
            You must be 18 or older, able to enter into a contract, and give accurate details. Naira features are for people in Nigeria.
            One person, one account; you may add bills for family members with their permission.
          </p>

          <h2>3. Your account and its security</h2>
          <ul>
            <li>Keep your sign-in methods (email, Google account, passkey or wallet) secure. You are responsible for activity on your account.</li>
            <li>
              For your safety you are signed out after 7 days without use and after 30 days in any case. You can sign out of every device
              from Account.
            </li>
            <li>Tell us straight away if you think someone else has used your account.</li>
            <li>We will never ask for your password, PIN, one-time code or private key.</li>
          </ul>

          <h2>4. Paying your bills</h2>
          <ul>
            <li>
              When you add a bill, you authorise ConstantUnits to pay it from your ConstantUnits balance, or from your stablecoins if you
              allowed that, on the schedule you chose, up to the limits you set. Change, pause or remove a bill at any time; changes apply to
              payments not yet started.
            </li>
            <li>
              Check the phone, meter and smartcard numbers you enter. Where the provider gives one, we show the name on the meter or decoder
              before you save it. A payment made to a number you entered is delivered to that number.
            </li>
            <li>
              We pay only when there is enough money and never above your limits. If a bill can&apos;t be paid (not enough money, a higher
              price, a provider problem), we tell you and nothing is taken.
            </li>
            <li>A bill is paid only once per cycle. If a provider&apos;s answer is unclear, we check with them before doing anything else.</li>
          </ul>

          <h2>5. Fees</h2>
          <p>
            Fees are listed on the <a href="/pricing">pricing page</a> and shown before you add a bill. A fee is charged only when a bill is
            delivered. Card, USSD and QR top-ups add the payment processor&apos;s fee at cost, shown before you pay. We will tell you before
            any fee changes.
          </p>

          <h2>6. Stablecoins</h2>
          <p>
            Stablecoins stay in your own wallet, which only you control. ConstantUnits can take only what a permission you signed allows, for
            the bill you chose, and you can revoke it at any time. Blockchain transactions can&apos;t be reversed, and token values and
            networks are outside our control. You are responsible for any wallet you connect and for keeping access to it.
          </p>

          <h2>7. Refunds</h2>
          <p>
            A bill that isn&apos;t delivered costs you nothing, fee included. The full rules are in the <a href="/refunds">refund policy</a>.
          </p>

          <h2>8. Things you must not do</h2>
          <ul>
            <li>Use ConstantUnits for fraud, money laundering, or with money that isn&apos;t yours to use.</li>
            <li>Pay bills for someone else&apos;s number or meter without their permission.</li>
            <li>Try to break, overload or get around the security of the service, or use it in a way that breaks the law.</li>
          </ul>
          <p>
            We may pause payments on, freeze or close an account to protect you or others, when we suspect fraud, or when the law requires
            it. Unless the law stops us, we will tell you why, and any money that is yours will be returned to you.
          </p>

          <h2>9. Availability</h2>
          <p>
            We work to keep ConstantUnits running at all times, but we can&apos;t promise it will never be interrupted. Networks, electricity
            companies, TV providers, banks and blockchains sometimes fail or delay; when they do, we retry or tell you, and we never take
            money for a bill that wasn&apos;t delivered.
          </p>

          <h2>10. Our liability</h2>
          <p>To the extent the law allows:</p>
          <ul>
            <li>
              We are responsible for paying your bills as you set them up and for returning money for bills that weren&apos;t delivered.
            </li>
            <li>
              We are not responsible for losses caused by wrong numbers you entered, by the network, electricity company or TV provider after
              a bill is delivered, by events outside our reasonable control, or for indirect losses such as lost profit or business.
            </li>
            <li>
              Our total liability to you for any claim is limited to the amount of the payment the claim is about plus the fees you paid us
              in the 12 months before the claim.
            </li>
          </ul>
          <p>
            Nothing in these terms limits liability that can&apos;t be limited by law, such as for fraud or wilful misconduct, or your rights
            under Nigerian consumer protection law.
          </p>

          <h2>11. Closing your account</h2>
          <p>
            You can close your account at any time in the app (Account, then Close account). Any money left in it is returned to a bank
            account in your name first. We may close an account under section 8, or after a long period without use, with notice.
          </p>

          <h2>12. Changes to these terms</h2>
          <p>
            We may update these terms as the service grows. For a change that matters, we will tell you in the app or by message at least 14
            days before it applies. If you don&apos;t agree, you can close your account before then.
          </p>

          <h2>13. Law and disputes</h2>
          <p>
            These terms are governed by the laws of the Federal Republic of Nigeria. If something goes wrong, write to us first; most issues
            are solved quickly. If we can&apos;t resolve it, you may bring the matter before the courts of Nigeria, or the Federal Competition
            and Consumer Protection Commission.
          </p>

          <LegalContact />
        </article>
      </main>
      <Footer base="/" />
    </>
  );
}
