import type { Metadata } from "next";
import { Footer } from "@/components/Footer";
import { PageHeader } from "@/components/PageHeader";
import { BILL_PRICES, TOPUP_EXAMPLES, TOPUP_RANGE } from "@/lib/pricing";

export const metadata: Metadata = {
  title: "Pricing | ConstantUnits",
  description: "What ConstantUnits costs: one small fee per delivered bill (data ₦50, airtime ₦30, cable ₦100, electricity ₦100). Your first payment is free; bank transfers are free.",
  alternates: { canonical: "/pricing" },
};

/** Rendered from @constant/rules, the same prices the database is tested against (D-075). */
export default function Pricing() {
  return (
    <>
      <PageHeader />
      <main id="main" className="container section" style={{ maxWidth: 820 }}>
        <article className="prose">
          <h1 className="h2">Pricing</h1>
          <p className="lede">No subscription. You pay for bills that are delivered, and nothing else.</p>

          <h2>One fee per bill</h2>
          <p>On top of what the provider charges, once the bill is delivered:</p>
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

          <p>
            The first delivered payment on a new account is free, and a failed or reversed payment costs nothing.
          </p>

          <h2>Adding money</h2>
          <p>
            <b>Bank transfer:</b> free. You get your own ConstantUnits account number; send money to it from any
            Nigerian bank or mobile money app, like any other transfer.
          </p>
          <p>
            <b>Card, USSD or QR</b> ({TOPUP_RANGE}), if you prefer: the card processor&apos;s fee (Paystack) is added at
            cost, so the full amount reaches your balance. You see the total before you pay.
          </p>
          <div className="price-table" role="table" aria-label="Card, USSD and QR top-ups">
            <div className="price-row price-head" role="row">
              <span role="columnheader">You add</span>
              <span role="columnheader">Card fee</span>
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

          <p className="muted">If a price changes, we tell you before it applies to you.</p>
        </article>
      </main>
      <Footer base="/" />
    </>
  );
}
