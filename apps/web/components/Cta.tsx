import { Reveal } from "./Reveal";
import { Scramble } from "./Scramble";
import { IconArrow } from "./icons";

const WORDS = ["data", "light", "DSTV", "airtime", "ChatGPT"];

export function Cta() {
  return (
    <section className="section" id="early" aria-labelledby="early-title">
      <div className="container">
        <Reveal className="cta">
          <div className="cta-orbit" aria-hidden="true">
            <div className="cta-orbit-spin" />
          </div>
          <span className="status">
            <span className="eyebrow-dot" /> Open now
          </span>
          <h2 id="early-title" className="cta-title">
            Never run out of <Scramble words={WORDS} /> again.
          </h2>
          <p className="cta-sub">Sign in with Google, email, your phone number or a passkey. No seed phrase, no forms.</p>
          <div>
            <a href="/app" className="btn btn-inverse">
              Launch app <IconArrow />
            </a>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
