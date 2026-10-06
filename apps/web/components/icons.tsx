import type { ReactNode, SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };

function Base({ size = 18, children, ...rest }: P & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const IconData = (p: P) => (
  <Base {...p}>
    <path d="M5 18v-3M10 18v-6M15 18V9M20 18V5" />
  </Base>
);
export const IconBolt = (p: P) => (
  <Base {...p}>
    <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" />
  </Base>
);
export const IconTv = (p: P) => (
  <Base {...p}>
    <rect x="3" y="6" width="18" height="12" rx="2.5" />
    <path d="m8 2 4 4 4-4M8 21h8" />
  </Base>
);
export const IconSpark = (p: P) => (
  <Base {...p}>
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6" />
  </Base>
);
export const IconCheck = (p: P) => (
  <Base {...p}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Base>
);
export const IconX = (p: P) => (
  <Base {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Base>
);
export const IconArrow = (p: P) => (
  <Base {...p} className={`arrow ${p.className ?? ""}`}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Base>
);
export const IconBell = (p: P) => (
  <Base {...p}>
    <path d="M6 9a6 6 0 1 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9Z" />
    <path d="M10 20a2 2 0 0 0 4 0" />
  </Base>
);
export const IconWallet = (p: P) => (
  <Base {...p}>
    <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18v4" />
    <rect x="4" y="7.5" width="16.5" height="12" rx="2.5" />
    <path d="M16 13.5h1.5" />
  </Base>
);
export const IconShield = (p: P) => (
  <Base {...p}>
    <path d="M12 3 5 6v5.5c0 4.4 3 8 7 9.5 4-1.5 7-5.1 7-9.5V6l-7-3Z" />
    <path d="m9 12 2 2 4-4" />
  </Base>
);
export const IconPause = (p: P) => (
  <Base {...p}>
    <rect x="6.5" y="5" width="3.5" height="14" rx="1" />
    <rect x="14" y="5" width="3.5" height="14" rx="1" />
  </Base>
);
export const IconGauge = (p: P) => (
  <Base {...p}>
    <path d="M4 15a8 8 0 1 1 16 0" />
    <path d="m12 15 4-5" />
  </Base>
);
export const IconReceipt = (p: P) => (
  <Base {...p}>
    <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z" />
    <path d="M9 8h6M9 12h6" />
  </Base>
);
export const IconBank = (p: P) => (
  <Base {...p}>
    <path d="M3 9.5 12 4l9 5.5M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20.5h18" />
  </Base>
);
export const IconGlobe = (p: P) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9S14.5 18.4 12 21c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3Z" />
  </Base>
);
export const IconChat = (p: P) => (
  <Base {...p}>
    <path d="M4 19.5 5.4 16A8 8 0 1 1 8.6 19L4 19.5Z" />
  </Base>
);
export const IconSend = (p: P) => (
  <Base {...p}>
    <path d="m21 3-9.5 18-2-7.5L2 11.5 21 3Z" />
    <path d="M21 3 9.5 13.5" />
  </Base>
);
export const IconSms = (p: P) => (
  <Base {...p}>
    <rect x="3.5" y="5" width="17" height="12" rx="2.5" />
    <path d="M8 20.5 11 17h2.5M8 11h.01M12 11h.01M16 11h.01" />
  </Base>
);
export const IconMail = (p: P) => (
  <Base {...p}>
    <rect x="3" y="5" width="18" height="14" rx="2.5" />
    <path d="m4 7 8 6 8-6" />
  </Base>
);
