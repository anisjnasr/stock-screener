import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  ...(process.env.STANDALONE === "1" ? { output: "standalone" as const } : {}),
};

export default nextConfig;
