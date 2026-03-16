import type { Metadata } from "next";
import { Inter, Geist_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://stock-screener-orfz.onrender.com";

export const metadata: Metadata = {
  title: "Stock Scanner",
  description: "Stock scanner – fundamentals, chart, screener, news",
  metadataBase: new URL(siteUrl),
  openGraph: {
    title: "Stock Scanner",
    description: "Stock scanner – fundamentals, chart, screener, news",
    url: "/",
    siteName: "Stock Scanner",
    type: "website",
    images: [
      {
        url: "/opengraph-image.png",
        width: 1200,
        height: 630,
        alt: "Stock Scanner",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Stock Scanner",
    description: "Stock scanner – fundamentals, chart, screener, news",
    images: ["/twitter-image.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${inter.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
