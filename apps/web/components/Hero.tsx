import { IconArrow } from "./icons";
import { PhoneMock } from "./PhoneMock";

function Words({ text, start = 0 }: { text: string; start?: number }) {
  return (
    <>
      {text.split(" ").map((w, k) => (
        <span className="word" key={k}>
          <span style={{ ["--i" as string]: start + k }}>{w}&nbsp;</span>
        </span>
      ))}
    </>
  );
}

export function Hero() {
  return (
    <section className="hero" id="top">
      <div className="container hero-grid">
        <div className="hero-copy">
          <span className="eyebrow fade-in">Autopay for bills in Nigeria</span>
          <h1 className="h1">
            <Words text="Set it once." />
            <br />
            <span className="serif">
              <Words text="Never run out." start={3} />
            </span>
          </h1>
          <p className="lead fade-in" style={{ ["--d" as string]: "420ms" }}>
            ConstantUnits pays data, airtime, light and TV for you, a friend or family, from money you set aside, on the
            day you choose. Subscriptions like ChatGPT and Claude get a reminder before they renew.
          </p>
          <div className="hero-actions fade-in" style={{ ["--d" as string]: "540ms" }}>
            <a href="/app" className="btn btn-primary">
              Launch app <IconArrow />
            </a>
            <a href="#how" className="btn btn-ghost">
              How it works
            </a>
          </div>
        </div>
        <PhoneMock />
      </div>
    </section>
  );
}
