import type { Metadata, Viewport } from "next";
import { Manrope, Geist_Mono } from "next/font/google";
import "./globals.css";

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "PortfolioOS PK",
  description:
    "Private PSX portfolio command center — personal portfolio tracking and research support only, not financial advice.",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "PortfolioOS PK",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f2f2f0",
};

import { Analytics } from "@vercel/analytics/next";
import { PwaUpdater } from "@/components/pwa-updater";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${manrope.variable} ${geistMono.variable} font-sans antialiased`}>
        {children}
        <PwaUpdater />
        {/* Vercel Web Analytics: cookieless visitor + page-view tracking.
            No-ops in local dev; requires Web Analytics enabled on the Vercel
            project. */}
        <Analytics />
      </body>
    </html>
  );
}
