import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";

const withSerwist = withSerwistInit({
  swSrc: "app/sw.ts",
  swDest: "public/sw.js",
  reloadOnOnline: true,
  disable: process.env.NODE_ENV === "development",
});

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdf-parse"],
  turbopack: { root: __dirname },
  images: {
    remotePatterns: [{ protocol: "https", hostname: "qclay.design" }],
  },
  experimental: {
    // Reuse client-side router cache briefly so back/forward navigation is
    // instant; router.refresh() after mutations still fetches fresh data.
    staleTimes: { dynamic: 30, static: 180 },
  },
};

export default withSerwist(nextConfig);
