import type { Metadata } from "next";
import { Footer } from "@/components/Footer";
import { PageHeader } from "@/components/PageHeader";
import { CONTACT_EMAIL } from "@/lib/site";

export const metadata: Metadata = {
  title: "Privacy | ConstantUnits",
  description: "What ConstantUnits collects, why, and how to have it deleted.",
  alternates: { canonical: "/privacy" },
};

const CONTACT = CONTACT_EMAIL;

export default function Privacy() {
  return (
    <>
      <PageHeader />
      <main id="main" className="container section" style={{ maxWidth: 760 }}>
        <article className="prose">
          <h1 className="h2">Privacy</h1>
          <p className="muted">Last updated October 2026</p>

          <h2>What we collect</h2>
          <p>
            When you sign in, our sign-in provider (Privy) gives us the details of the method you chose: your email
            address, phone number, Google name and email, or wallet address. ConstantUnits also creates a wallet address for
            you, for stablecoins; only you control it. We do not use tracking cookies or sell data.
          </p>
          <p>
            During the preview, the bills you add (numbers, meter and decoder numbers, amounts and readings) are saved
            only on your device, not on our servers.
          </p>

          <h2>Why</h2>
          <p>To sign you in, show your bills and reminders, and, once payments open, to pay them and send you receipts.</p>

          <h2>Your money</h2>
          <p>
            ConstantUnits does not hold money yet. When payments launch, money set aside in ConstantUnits will be held by a
            licensed payment partner, never in a personal account. We will name the partner here before anyone can add
            money.
          </p>

          <h2>Deleting your details</h2>
          <p>
            Reply to any message we send you and ask us to delete your details
            {CONTACT ? (
              <>
                , or write to <a href={`mailto:${CONTACT}`}>{CONTACT}</a>
              </>
            ) : null}
            . We remove them within 7 days.
          </p>

          <h2>The law</h2>
          <p>We handle personal data in line with the Nigeria Data Protection Act 2023.</p>
        </article>
      </main>
      <Footer base="/" />
    </>
  );
}
