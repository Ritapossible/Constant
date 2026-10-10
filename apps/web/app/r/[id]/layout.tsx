import type { Metadata } from "next";
import type { ReactNode } from "react";
import "../../app/app.css";

export const metadata: Metadata = {
  title: "Receipt | Constant",
  robots: { index: false, follow: false },
};

export default function ReceiptLayout({ children }: { children: ReactNode }) {
  return children;
}
