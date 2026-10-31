import "@fontsource-variable/inter-tight";
import "@fontsource-variable/jetbrains-mono";
import "./globals.css";

import type { Metadata, Viewport } from "next";
import { SmoothScroll } from "@/components/SmoothScroll";
import { SITE_DESCRIPTION, SITE_TITLE, SITE_URL, X_HANDLE } from "@/lib/site";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  applicationName: "ConstantUnits",
  alternates: { canonical: "/" },
  robots: { index: true, follow: true },
  openGraph: {
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    url: "/",
    type: "website",
    siteName: "ConstantUnits",
    locale: "en_NG",
  },
  twitter: { card: "summary_large_image", site: `@${X_HANDLE}`, creator: `@${X_HANDLE}`, title: SITE_TITLE, description: SITE_DESCRIPTION },
};

// Tells Google what ConstantUnits is (structured data).
const JSON_LD = {
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "Organization", "@id": `${SITE_URL}/#org`, name: "ConstantUnits", url: SITE_URL, logo: `${SITE_URL}/icon.svg` },
    { "@type": "WebSite", "@id": `${SITE_URL}/#site`, name: "ConstantUnits", url: SITE_URL, publisher: { "@id": `${SITE_URL}/#org` } },
    {
      "@type": "Service",
      name: "ConstantUnits autopay",
      serviceType: "Automatic bill payments for data, airtime, electricity, cable TV and subscriptions",
      provider: { "@id": `${SITE_URL}/#org` },
      areaServed: { "@type": "Country", name: "Nigeria" },
      description: SITE_DESCRIPTION,
    },
  ],
};

export const viewport: Viewport = {
  themeColor: "#f7f7f5",
  width: "device-width",
  initialScale: 1,
};

const SCROLL_TOP =
  "try{if('scrollRestoration' in history)history.scrollRestoration='manual';if(!location.hash)window.scrollTo(0,0)}catch(e){}";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }} />
        {/* A refresh starts at the top, not where the reader was; a link to a section (#pricing) still lands there. */}
        <script dangerouslySetInnerHTML={{ __html: SCROLL_TOP }} />
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <SmoothScroll />
        {children}
      </body>
    </html>
  );
}
