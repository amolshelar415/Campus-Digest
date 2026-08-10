import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "Campus Digest — Smart Academic Notification Aggregator",
  description:
    "Campus Digest unifies your college Gmail and Telegram into one intelligent dashboard. Automatically classify, prioritize, and never miss a placement drive or faculty notice again.",
  keywords: ["campus", "college", "notifications", "Gmail", "Telegram", "placement", "digest"],
  openGraph: {
    title: "Campus Digest",
    description: "Smart Academic Notification Aggregator for college students",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="h-full">{children}</body>
    </html>
  );
}
