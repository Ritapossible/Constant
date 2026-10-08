import type { Metadata, Viewport } from "next";
import "./app.css";

export const metadata: Metadata = {
  title: "App | Constant",
  description: "Your Constant account: bills, reminders and money.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: "#f7f7f5" };

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return children;
}
