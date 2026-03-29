import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  ...(process.env.STANDALONE === "1" ? { output: "standalone" as const } : {}),
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
