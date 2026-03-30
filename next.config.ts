import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  ...(process.env.STANDALONE === "1" ? { output: "standalone" as const } : {}),
  serverExternalPackages: ["better-sqlite3"],
  compress: true,
  experimental: {
    optimizePackageImports: ["recharts", "framer-motion", "lightweight-charts"],
  },
};

export default nextConfig;
