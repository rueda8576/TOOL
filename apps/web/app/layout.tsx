import type { Metadata } from "next";
import { Space_Grotesk, Source_Serif_4 } from "next/font/google";
import "katex/dist/katex.min.css";

import "./globals.css";

const heading = Space_Grotesk({ subsets: ["latin"], variable: "--font-heading" });
const body = Source_Serif_4({ subsets: ["latin"], variable: "--font-body" });

export const metadata: Metadata = {
  title: "WorkMesh",
  description: "WorkMesh collaboration workspace"
};

export default function RootLayout({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <html lang="en" className={`${heading.variable} ${body.variable}`}>
      <body className="app-root">{children}</body>
    </html>
  );
}
