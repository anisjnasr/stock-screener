import type { Metadata } from "next";
import { Inter, Geist_Mono } from "next/font/google";
import "./globals.css";
import ServiceWorkerRegistration from "@/components/ServiceWorkerRegistration";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://stock-screener-orfz.onrender.com";

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export const metadata: Metadata = {
  title: "StockStalker",
  description: "Lean stock scanning platform for swing traders",
  metadataBase: new URL(siteUrl),
  applicationName: "StockStalker",
  manifest: "/site.webmanifest",
  other: { "theme-color": "#0a0e14" },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "48x48" },
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    shortcut: ["/favicon.ico"],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  openGraph: {
    title: "StockStalker",
    description: "Lean stock scanning platform for swing traders",
    url: "/",
    siteName: "StockStalker",
    type: "website",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "StockStalker",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "StockStalker",
    description: "Lean stock scanning platform for swing traders",
    images: ["/twitter-card.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{var t=localStorage.getItem("stock-research-theme");if(t==="light"){document.documentElement.classList.remove("dark");document.documentElement.classList.add("light")}else if(t==="dark"||!t){document.documentElement.classList.add("dark");document.documentElement.classList.remove("light")}else{var m=window.matchMedia("(prefers-color-scheme:dark)").matches;document.documentElement.classList.toggle("dark",m);document.documentElement.classList.toggle("light",!m)}}catch(e){}})()` }} />
      </head>
      <body
        className={`${inter.variable} ${geistMono.variable} antialiased`}
      >
        {children}
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
