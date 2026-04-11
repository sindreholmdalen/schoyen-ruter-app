import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ruteplanlegger – Schøyen & Horntvedt AS",
  description:
    "Registrer dagens føresedler og få 4 optimaliserte kjøreruter med PDF per sjåfør.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#1e3a8a",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="nb">
      <body className="min-h-screen bg-slate-50">{children}</body>
    </html>
  );
}
