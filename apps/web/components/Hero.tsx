import { IconArrow, IconCheck } from "./icons";
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
      <div className="hero-bg" />
      <div className="container hero-grid">
        <div className="hero-copy">
          <span className="eyebrow fade-in">
            <span className="eyebrow-dot" /> Autopay for utilities
          </span>
          <h1 className="h1">
            <Words text="Set it once." />
            <br />
            <span className="serif">
              <Words text="Never run out." start={3} />
            </span>
          </h1>
          <p className="lead fade-in" style={{ ["--d" as string]: "420ms" }}>
            Constant pays your data, light, cable and subscriptions from money you set aside, and warns you before
            anything runs low.
          </p>
          <div className="hero-actions fade-in" style={{ ["--d" as string]: "540ms" }}>
            <a href="/app" className="btn btn-primary">
              Launch app <IconArrow />
            </a>
            <a href="#how" className="btn btn-ghost">
              How it works
            </a>
          </div>
          <div className="hero-note fade-in" style={{ ["--d" as string]: "660ms" }}>
            <span>
              <IconCheck size={15} /> Caps you set
            </span>
            <span>
              <IconCheck size={15} /> Pause any time
            </span>
            <span>
              <IconCheck size={15} /> Naira or stables
            </span>
          </div>
        </div>
        <PhoneMock />
      </div>
    </section>
  );
}
