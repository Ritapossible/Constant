import { Logo } from "./Logo";

const LINKS = [
  { href: "#pays", label: "What it pays" },
  { href: "#remind", label: "Reminders" },
  { href: "#how", label: "How it works" },
  { href: "#faq", label: "FAQ" },
  { href: "#early", label: "Early access" },
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
            <span>© {new Date().getFullYear()} Constant. All rights reserved.</span>
            <span>Early access. Money is only ever held by a licensed partner.</span>
          </div>
        </div>
        <div className="footer-word" aria-hidden="true">
          Constant
        </div>
      </div>
    </footer>
  );
}
