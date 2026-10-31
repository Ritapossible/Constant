import { Reveal } from "./Reveal";
import { IconArrow } from "./icons";

export function Cta() {
  return (
    <section className="section" id="early" aria-labelledby="early-title">
      <div className="container">
        <Reveal className="cta">
          <span className="status">Preview open</span>
          <h2 id="early-title" className="cta-title">
            Set up your bills today
          </h2>
          <p className="cta-sub">Sign in with Google, email, your phone number or a passkey. No seed phrase, no forms. In the preview you set up your bills; payments switch on with our licensed partner.</p>
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
