/** The mark: a "C" with a steady level line running through it: the level that never drops. */
export function LogoMark({ className = "logo-mark", inverse = false }: { className?: string; inverse?: boolean }) {
  const bg = inverse ? "#fafafa" : "#0a0a0a";
  const fg = inverse ? "#0a0a0a" : "#fafafa";
  return (
    <svg className={className} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="9" fill={bg} />
      <path d="M22.5 10.6A8.5 8.5 0 1 0 22.5 21.4" fill="none" stroke={fg} strokeWidth="2.4" strokeLinecap="round" />
      <path d="M13.5 16H25.5" stroke={fg} strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

export function Logo() {
  return (
    <span className="logo">
      <LogoMark />
      Constant
    </span>
  );
}
