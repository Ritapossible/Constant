import { CONTACT_EMAIL, SOCIALS } from "@/lib/site";
import { Logo } from "./Logo";

const LINKS = [
  { href: "#pays", label: "What it pays" },
  { href: "#remind", label: "Reminders" },
  { href: "#how", label: "How it works" },
  { href: "#faq", label: "FAQ" },
  { href: "/pricing", label: "Pricing" },
  { href: "/app", label: "Launch app" },
  { href: "/terms", label: "Terms" },
  { href: "/privacy", label: "Privacy" },
  { href: "/refunds", label: "Refunds" },
  { href: "/proof", label: "Stellar testnet proof" },
];

/** Brand marks as each company publishes them (X brand toolkit; Instagram glyph), drawn in the footer's ink. */
const ICONS: Record<"X" | "Instagram", React.ReactNode> = {
  X: (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77Z" />
    </svg>
  ),
  Instagram: (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4.2" />
      <circle cx="17.4" cy="6.6" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  ),
};

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
              <div className="footer-socials">
                
                <ul>
                  {SOCIALS.map((x) => (
                    <li key={x.name}>
                      {x.url ? (
                        <a href={x.url} target="_blank" rel="noopener noreferrer" aria-label={`ConstantUnits on ${x.name} (opens in a new tab)`} title={`@${x.handle} on ${x.name}`}>
                          {ICONS[x.name]}
                        </a>
                      ) : (
                        <span className="footer-social-soon" role="img" aria-label={`${x.name}, coming soon`} title={`${x.name}: coming soon`}>
                          {ICONS[x.name]}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
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
      </div>
    </footer>
  );
}
