import "@fontsource-variable/inter-tight";
import "@fontsource-variable/jetbrains-mono";
import "@fontsource/instrument-serif/400-italic.css";
import "./globals.css";

import type { Metadata, Viewport } from "next";
import { SmoothScroll } from "@/components/SmoothScroll";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://constant.ng";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "Constant — Set it once. Never run out.",
  description:
    "Constant pays your data, light, cable and subscriptions from money you set aside, and warns you before anything runs low.",
  openGraph: {
    title: "Constant — Set it once. Never run out.",
    description: "Data, light, cable and subscriptions, paid automatically. Warned before anything runs low.",
    type: "website",
    siteName: "Constant",
  },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = {
  themeColor: "#f7f7f5",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <SmoothScroll />
        {children}
      </body>
    </html>
  );
}
