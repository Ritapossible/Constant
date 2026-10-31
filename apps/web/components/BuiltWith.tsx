/**
 * The infrastructure ConstantUnits is built on, as one still row (D-095: nothing loops). Only services the code actually integrates
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
      <ul className="container built-row">
        {BRANDS.map((b) => (
          <li className="built-item" key={b.name}>
            <img src={b.logo} alt="" width={24} height={24} loading="lazy" decoding="async" />
            <span>{b.name}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
