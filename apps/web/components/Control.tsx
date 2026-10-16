import { Reveal } from "./Reveal";
import { IconGauge, IconPause, IconReceipt, IconShield } from "./icons";

const ITEMS = [
  { icon: <IconGauge />, title: "Caps you set", text: "A weekly limit per bill. Constant never spends past it." },
  { icon: <IconPause />, title: "Pause or cancel", text: "One tap in the app, or send STOP." },
  { icon: <IconShield />, title: "Never on a guess", text: "It buys on a real reading or a renewal date. Nothing else." },
  { icon: <IconReceipt />, title: "A receipt for everything", text: "Every naira in and out, on the channel you chose." },
];

/** What a bill can be: the providers' own logos, the same files the app uses (D-071). */
const WORKS_WITH = [
  { name: "MTN", logo: "/providers/mtn.jpg" },
  { name: "Airtel", logo: "/providers/airtel.jpg" },
  { name: "Glo", logo: "/providers/glo.jpg" },
  { name: "T2", logo: "/providers/9mobile.jpg" },
  { name: "Ikeja Electric", logo: "/providers/ikedc.jpg" },
  { name: "Eko Electricity", logo: "/providers/ekedc.jpg" },
  { name: "Abuja Electricity", logo: "/providers/aedc.jpg" },
  { name: "Enugu Electricity", logo: "/providers/eedc.jpg" },
  { name: "DStv", logo: "/providers/dstv.jpg" },
  { name: "GOtv", logo: "/providers/gotv.jpg" },
  { name: "StarTimes", logo: "/providers/startimes.jpg" },
  { name: "ChatGPT", logo: "/providers/chatgpt.png" },
  { name: "Claude", logo: "/providers/claude.png" },
  { name: "Gemini", logo: "/providers/gemini.png" },
  { name: "Spotify", logo: "/providers/spotify.png" },
  { name: "Netflix", logo: "/providers/netflix.svg" },
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
              <img src={w.logo} alt="" width={28} height={28} loading="lazy" decoding="async" />
              {w.name}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
