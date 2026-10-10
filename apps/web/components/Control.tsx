import { Reveal } from "./Reveal";
import { IconGauge, IconPause, IconReceipt, IconShield } from "./icons";

const ITEMS = [
  { icon: <IconGauge />, title: "Caps you set", text: "A weekly limit per bill. Constant never spends past it." },
  { icon: <IconPause />, title: "Pause or cancel", text: "One tap in the app, or send STOP." },
  { icon: <IconShield />, title: "Never on a guess", text: "It buys on a real reading or a renewal date. Nothing else." },
  { icon: <IconReceipt />, title: "A receipt for everything", text: "Every naira in and out, on the channel you chose." },
];

const WORKS_WITH = [
  "MTN", "Airtel", "Glo", "9mobile", "DSTV", "GOtv", "StarTimes", "IKEDC", "EKEDC", "EEDC", "AEDC", "ChatGPT", "Claude", "Gemini",
];

export function Control() {
  return (
    <section className="section section-marquee" aria-labelledby="control-title">
      <div className="container">
        <Reveal className="section-head">
          <span className="eyebrow">You stay in control</span>
          <h2 id="control-title" className="h2">
            Your money. <span className="serif">Your rules.</span>
          </h2>
        </Reveal>
        <Reveal className="control">
          {ITEMS.map((it) => (
            <div className="control-item" key={it.title}>
              <span className="icon-box">{it.icon}</span>
              <h3 className="h3" style={{ fontSize: 19 }}>
                {it.title}
              </h3>
              <p>{it.text}</p>
            </div>
          ))}
        </Reveal>
      </div>
      <div className="marquee" aria-label="Networks, DisCos and services">
        <div className="marquee-track">
          {[...WORKS_WITH, ...WORKS_WITH].map((w, i) => (
            <span className="marquee-item" key={i} aria-hidden={i >= WORKS_WITH.length}>
              {w}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
