import { Reveal } from "./Reveal";

const STEPS = [
  { title: "Add money", text: "Bank transfer, card or USSD in naira. It sits in pots, one for each bill." },
  { title: "Add what to keep paid", text: "Data, airtime, light, DStv or a subscription, for you or someone else. The number, meter or decoder goes in once." },
  { title: "Set your limits", text: "How much, how often, and a cap it can never pass. Change or pause any time." },
  { title: "ConstantUnits keeps watch", text: "It pays on the date, tops up when you tap, and tells you before a bill can't be paid." },
  { title: "Paid, and sent to you", text: "Bundles land on the SIM. Tokens and receipts arrive on Telegram, SMS or email." },
];

/** Five steps, all visible at once: nothing to scroll through to read them (D-095). */
export function Steps() {
  return (
    <section className="section" id="how" aria-labelledby="how-title">
      <div className="container">
        <Reveal className="section-head">
          <span className="eyebrow">How it works</span>
          <h2 id="how-title" className="h2">
            Set up in five minutes
          </h2>
        </Reveal>
        <Reveal>
          <ol className="steps-list">
            {STEPS.map((s, i) => (
              <li key={s.title}>
                <span className="steps-n">{String(i + 1).padStart(2, "0")}</span>
                <h3 className="steps-title">{s.title}</h3>
                <p>{s.text}</p>
              </li>
            ))}
          </ol>
        </Reveal>
      </div>
    </section>
  );
}
