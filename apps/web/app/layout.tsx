import "./globals.css";
import type { ReactNode } from "react";

export const metadata = {
  title: "QuoteAgent — Reviewer",
  description: "Linkport Forwarders — inbound quote requests awaiting review.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
