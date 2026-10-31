/**
 * The infrastructure ConstantUnits is built on, as a moving strip. Only services the code actually integrates
 * (packages/partners, packages/chains, the app); logos from each company's own website, unaltered (D-073).
 * "Built with", never "partners": none of these endorse ConstantUnits.
 */
const BRANDS = [
  { name: "Paystack", logo: "/brands/paystack.png" },
  { name: "VTpass", logo: "/brands/vtpass.png" },
  { name: "Paycrest", logo: "/brands/paycrest.png" },
  { name: "Circle", logo: "/brands/circle.svg" },
  { name: "Privy", logo: "/brands/privy.png" },
  { name: "Coinbase", logo: "/brands/coinbase.png" },
  { name: "Base", logo: "/brands/base.svg" },
  { name: "Arc", logo: "/brands/arc.svg" },
  { name: "Stellar", logo: "/brands/stellar.png" },
  { name: "Termii", logo: "/brands/termii.png" },
  { name: "Resend", logo: "/brands/resend.png" },
];

export function BuiltWith() {
  return (
    <section className="built" aria-labelledby="built-title">
      <div className="container">
        <p id="built-title" className="built-title">
          Built with
        </p>
      </div>
      <div className="marquee built-marquee">
        <div className="marquee-track">
          {[...BRANDS, ...BRANDS].map((b, i) => (
            <span className="built-item" key={i} aria-hidden={i >= BRANDS.length}>
              <img src={b.logo} alt="" width={36} height={36} loading="lazy" decoding="async" />
              <span>{b.name}</span>
            </span>
          ))}
        </div>
      </div>
      <ul className="sr-only">
        {BRANDS.map((b) => (
          <li key={b.name}>{b.name}</li>
        ))}
      </ul>
    </section>
  );
}
