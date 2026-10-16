import { feeForKind } from "@constant/rules";
import { Reveal } from "./Reveal";

const naira = (minor: bigint) => `₦${(minor / 100n).toLocaleString("en-NG")}`;

/**
 * What ConstantUnits costs and what happens to unused money, from the same prices the database charges (D-075).
 * Nothing here may promise withdrawals until the funding partner confirms them in writing (D-050).
 */
const POINTS = [
  { big: naira(0n), title: "Data, airtime and TV", text: "No fee. You pay what the network or provider charges." },
  { big: naira(feeForKind("electricity")), title: "Per electricity token", text: "Only when the token is delivered. A failed buy costs nothing." },
  { big: naira(0n), title: "To add money by transfer", text: "To your own account number. Card, USSD or QR at Paystack's cost." },
  { big: "Yours", title: "Unused money", text: "It stays in its pot until that bill needs it. It doesn't expire." },
];

export function Fair() {
  return (
    <section className="section" id="pricing" aria-labelledby="fair-title">
      <div className="container">
        <Reveal className="section-head">
          <span className="eyebrow">Pricing</span>
          <h2 id="fair-title" className="h2">
            Pay for what&apos;s delivered. <span className="serif">Nothing else.</span>
          </h2>
          <p className="lead">No subscription and no monthly fee.</p>
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
        <p className="fair-more">
          <a href="/pricing">See full pricing</a>
        </p>
      </div>
    </section>
  );
}
