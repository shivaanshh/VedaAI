import type { Metadata, Viewport } from "next";
import "./globals.css";

/* The product's own faces:
   - Figtree runs the interface.
   - Bricolage Grotesque sets the display headings and the wordmark.
   - Fragment Mono sets question references, where column alignment is meaning.

   Loaded via stylesheet rather than next/font on purpose. next/font fetches at
   BUILD time, so a slow or blocked Google Fonts response turns a font problem
   into a failed deployment. A stylesheet link degrades to the fallback stack
   instead, which is the failure mode worth having. */

export const metadata: Metadata = {
  title: "VedaAI — Question Paper to Answer Sheet",
  description:
    "Upload a question paper and a handwritten answer sheet. See which question was answered, where the answer sits on the page, and what was left blank.",
};

export const viewport: Viewport = {
  themeColor: "#FFFFFF",
  width: "device-width",
  initialScale: 1,
};

const FONT_HREF =
  "https://fonts.googleapis.com/css2?" +
  "family=Figtree:wght@400;500;600;700;800&" +
  "family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,700;12..96,800&" +
  "family=Fragment+Mono&display=swap";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="stylesheet" href={FONT_HREF} />
      </head>
      <body className="min-h-screen bg-canvas text-ink antialiased">{children}</body>
    </html>
  );
}
