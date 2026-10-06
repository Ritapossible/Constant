import type { Metadata } from "next";
import { Footer } from "@/components/Footer";
import { Logo } from "@/components/Logo";

export const metadata: Metadata = {
  title: "Privacy | Constant",
  description: "What Constant collects during early access, why, and how to have it deleted.",
  alternates: { canonical: "/privacy" },
};

const CONTACT = process.env.NEXT_PUBLIC_CONTACT_EMAIL;

export default function Privacy() {
  return (
    <>
      <header className="container" style={{ paddingTop: 28 }}>
        <a href="/" aria-label="Constant home">
          <Logo />
        </a>
      </header>
      <main id="main" className="container section" style={{ maxWidth: 760 }}>
        <article className="prose">
          <h1 className="h2">Privacy</h1>
          <p className="muted">Early access · last updated October 2026</p>

          <h2>What we collect</h2>
          <p>
            When you join early access, the phone number or email address you type in, the time, and the country your
            request came from. Nothing else. We do not use tracking cookies or sell data.
          </p>

          <h2>Why</h2>
          <p>Only to tell you when your early access spot opens, and to ask a few questions about the bills you pay.</p>

          <h2>Your money</h2>
          <p>
            Constant does not hold money yet. When payments launch, money set aside in Constant will be held by a
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
