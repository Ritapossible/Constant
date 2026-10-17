import { KIND_PRICES } from "@constant/rules";
import { Reveal } from "./Reveal";

const naira = (minor: bigint) => `₦${(minor / 100n).toLocaleString("en-NG")}`;

/**
 * What ConstantUnits costs and what happens to unused money, from the same prices the database charges (D-075).
 * Nothing here may promise withdrawals until the funding partner confirms them in writing (D-050).
 */
/** The four fees, from the price list (D-077), each with when it's charged. */
const POINTS = KIND_PRICES.map((k) => ({ big: naira(k.feeMinor), title: k.label, text: k.basis }));

export function Fair() {
  return (
    <section className="section" id="pricing" aria-labelledby="fair-title">
      <div className="container">
        <Reveal className="section-head">
          <span className="eyebrow">Pricing</span>
          <h2 id="fair-title" className="h2">
            Pay for what&apos;s delivered. <span className="serif">Nothing else.</span>
          </h2>
          <p className="lead">One small fee per bill, only when it&apos;s delivered. No subscription.</p>
        </Reveal>
        <Reveal className="fair">
          {POINTS.map((p) => (
            <div className="fair-item" key={p.title}>
              <span className="fair-big">{p.big}</span>
              <h3 className="h3">{p.title}</h3>
              <p>{p.text}</p>
            </div>
          ))}
        </Reveal>
        <p className="fair-note">
          The first delivered payment on a new account is free, and a failed or reversed payment costs nothing. Adding
          money by bank transfer is free.
        </p>
        <p className="fair-more">
          <a href="/pricing">See full pricing</a>
        </p>
      </div>
    </section>
  );
}
