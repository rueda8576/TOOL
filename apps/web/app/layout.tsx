import type { Metadata } from "next";
import { Inter, Source_Serif_4 } from "next/font/google";
import "katex/dist/katex.min.css";

import "./globals.css";

const heading = Source_Serif_4({ subsets: ["latin"], variable: "--font-heading" });
const body = Inter({ subsets: ["latin"], variable: "--font-body" });
const metadataBase = new URL(process.env.NEXT_PUBLIC_APP_URL ?? "https://atlasium.info");

export const metadata: Metadata = {
  metadataBase,
  applicationName: "Atlasium",
  title: {
    default: "Atlasium - Doctoral research workspace",
    template: "%s - Atlasium"
  },
  description:
    "Atlasium is a doctoral research workspace for documents, wiki knowledge, managed code, meetings, tasks, and traceable project collaboration.",
  manifest: "/site.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon-48x48.png", sizes: "48x48", type: "image/png" },
      { url: "/favicon-192x192.png", sizes: "192x192", type: "image/png" },
      { url: "/atlasium-icon.svg", type: "image/svg+xml" }
    ],
    shortcut: "/favicon.ico",
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }]
  },
  openGraph: {
    title: "Atlasium - Doctoral research workspace",
    description:
      "A contemporary research workspace for doctoral documents, wiki knowledge, managed code, meetings, tasks, and traceability.",
    url: metadataBase,
    siteName: "Atlasium",
    images: [
      {
        url: "/atlasium-og.svg",
        width: 1200,
        height: 630,
        alt: "Atlasium doctoral research workspace"
      }
    ],
    locale: "en_US",
    type: "website"
  },
  twitter: {
    card: "summary_large_image",
    title: "Atlasium - Doctoral research workspace",
    description:
      "Documents, wiki knowledge, managed code, meetings, tasks, and traceability for doctoral research teams.",
    images: ["/atlasium-og.svg"]
  }
};

export default function RootLayout({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <html lang="en" className={`${heading.variable} ${body.variable}`}>
      <body className="app-root">{children}</body>
    </html>
  );
}
