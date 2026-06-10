import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdf-parse"],
  turbopack: { root: __dirname },
  experimental: {
    // Reuse client-side router cache briefly so back/forward navigation is
    // instant; router.refresh() after mutations still fetches fresh data.
    staleTimes: { dynamic: 30, static: 180 },
  },
};

export default nextConfig;
