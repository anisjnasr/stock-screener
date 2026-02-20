import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { ApiKeyGate } from "@/components/ApiKeyGate";
import { SearchBar } from "@/components/SearchBar";
import Link from "next/link";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "Stock Analysis Tool",
  description: "US equities, indices, and futures analysis for retail traders",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.variable} min-h-screen bg-zinc-900 font-sans text-zinc-100 antialiased`}>
        <ApiKeyGate>
          <header className="sticky top-0 z-40 border-b border-zinc-700 bg-zinc-900/95 backdrop-blur">
            <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4">
              <Link
                href="/"
                className="shrink-0 font-semibold text-white hover:text-emerald-400"
              >
                Home
              </Link>
              <div className="min-w-0 flex-1">
                <SearchBar />
              </div>
            </div>
          </header>
          <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
        </ApiKeyGate>
      </body>
    </html>
  );
}
