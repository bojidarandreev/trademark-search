import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Providers from "./providers";
import { SpeedInsights } from "@vercel/speed-insights/next"; // <-- IMPORT ADDED

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Trademark Search",
  description: "Search for trademarks using the INPI API",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <Providers>{children}</Providers>
        <SpeedInsights /> {/* <-- COMPONENT ADDED HERE */}
      </body>
    </html>
  );
}
