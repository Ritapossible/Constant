import type { Metadata } from "next";
import { Footer } from "@/components/Footer";
import { Logo } from "@/components/Logo";
import { BILL_PRICES, FACTS, TOPUP_EXAMPLES, TOPUP_RANGE } from "@/lib/pricing";

export const metadata: Metadata = {
  title: "Pricing | ConstantUnits",
  description: "What ConstantUnits costs: no subscription, no fee on data, airtime and TV, ₦100 per electricity token, and card top-ups at Paystack's cost.",
  alternates: { canonical: "/pricing" },
};

/** Rendered from @constant/rules, the same prices the database is tested against (D-075). */
export default function Pricing() {
  return (
    <>
      <header className="container" style={{ paddingTop: 28 }}>
        <a href="/" aria-label="ConstantUnits home">
          <Logo />
        </a>
      </header>
      <main id="main" className="container section" style={{ maxWidth: 820 }}>
        <article className="prose">
          <h1 className="h2">Pricing</h1>
          <p className="lede">No subscription. You pay for bills that are delivered, and nothing else.</p>

          <h2>Bills</h2>
          <div className="price-table" role="table" aria-label="Fee per bill">
            {BILL_PRICES.map((b) => (
              <div className="price-row" role="row" key={b.kind}>
                <span role="cell" className="price-name">
                  {b.label}
                </span>
                <span role="cell" className="price-fee">
                  {b.fee}
                </span>
                <span role="cell" className="price-basis">
                  {b.basis}
                </span>
              </div>
            ))}
          </div>

          <h2>Adding money</h2>
          <p>
            <b>Bank transfer to your own ConstantUnits account number:</b> free.
          </p>
          <p>
            <b>Card, USSD or QR</b> ({TOPUP_RANGE}): Paystack&apos;s fee is added at cost, so the full amount reaches
            your balance. You see the total before you pay.
          </p>
          <div className="price-table" role="table" aria-label="Card, USSD and QR top-ups">
            <div className="price-row price-head" role="row">
              <span role="columnheader">You add</span>
              <span role="columnheader">Paystack&apos;s fee</span>
              <span role="columnheader">You pay</span>
            </div>
            {TOPUP_EXAMPLES.map((t) => (
              <div className="price-row" role="row" key={t.credit}>
                <span role="cell">{t.credit}</span>
                <span role="cell">{t.fee}</span>
                <span role="cell">{t.total}</span>
              </div>
            ))}
          </div>
          <p>
            <b>Stablecoins</b> (USDC or USDT on Base, USDC on Arc): the same naira fees, converted at the market rate.
          </p>

          <h2>Always</h2>
          <ul>
            {FACTS.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
          <p className="muted">If a price changes, we tell you before it applies to you.</p>
        </article>
      </main>
      <Footer base="/" />
    </>
  );
}
