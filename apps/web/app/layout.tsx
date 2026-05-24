import type { Metadata } from "next";
import { Inter, Source_Serif_4 } from "next/font/google";
import "katex/dist/katex.min.css";

import "./globals.css";

const heading = Source_Serif_4({ subsets: ["latin"], variable: "--font-heading" });
const body = Inter({ subsets: ["latin"], variable: "--font-body" });

export const metadata: Metadata = {
  title: "Atlasium",
  description: "Atlasium collaboration workspace"
};

export default function RootLayout({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <html lang="en" className={`${heading.variable} ${body.variable}`}>
      <body className="app-root">{children}</body>
    </html>
  );
}
