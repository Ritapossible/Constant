import { Logo } from "./Logo";

/** The header of the simple pages (pricing, privacy): a way back home, then the logo. */
export function PageHeader() {
  return (
    <header className="container page-header">
      <a href="/" className="page-back" aria-label="Back to the home page">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M19 12H5M11 18l-6-6 6-6" />
        </svg>
      </a>
      <a href="/" aria-label="ConstantUnits home">
        <Logo />
      </a>
    </header>
  );
}
