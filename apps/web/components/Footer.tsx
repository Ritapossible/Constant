import { CONTACT_EMAIL, X_HANDLE, X_URL } from "@/lib/site";
import { Logo } from "./Logo";

const LINKS = [
  { href: "#pays", label: "What it pays" },
  { href: "#remind", label: "Reminders" },
  { href: "#how", label: "How it works" },
  { href: "#faq", label: "FAQ" },
  { href: "/pricing", label: "Pricing" },
  { href: "/app", label: "Launch app" },
  { href: "/privacy", label: "Privacy" },
];

/** `base` is "/" on other pages so section links go back to the home page. */
export function Footer({ base = "" }: { base?: string }) {
  return (
    <footer className="footer">
      <div className="container">
        <div className="footer-card">
          <div className="footer-top">
            <div>
              <Logo />
              <p className="footer-tag">Set it once. Never run out of data, light, TV or the tools you pay for.</p>
              <p className="footer-contact">
                Questions? <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
              </p>
              <a className="footer-social" href={X_URL} target="_blank" rel="noopener noreferrer" aria-label={`Follow ConstantUnits on X, @${X_HANDLE} (opens in a new tab)`}>
                <span className="footer-social-icon" aria-hidden="true">
                  {/* The X logo, as published in X's brand toolkit. */}
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77Z" />
                  </svg>
                </span>
                <span>
                  Follow <b>@{X_HANDLE}</b> for updates
                </span>
              </a>
            </div>
            <nav className="footer-links" aria-label="Footer">
              <h4>Quick links</h4>
              {LINKS.map((l) => (
                <a key={l.href} href={l.href.startsWith("#") ? `${base}${l.href}` : l.href}>
                  {l.label}
                </a>
              ))}
            </nav>
          </div>
          <div className="footer-bottom">
            <span>© {new Date().getFullYear()} ConstantUnits. All rights reserved.</span>
            <span>Early access. Money is only ever held by a licensed partner.</span>
          </div>
        </div>
        <div className="footer-word" aria-hidden="true">
          Constant<span>Units</span>
        </div>
      </div>
    </footer>
  );
}
