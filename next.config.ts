import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";

const withSerwist = withSerwistInit({
  swSrc: "app/sw.ts",
  swDest: "public/sw.js",
  reloadOnOnline: true,
  disable: process.env.NODE_ENV === "development",
});

const nextConfig: NextConfig = {
  // @psx/shared ships raw TypeScript so the mobile app and this app read the
  // same source. Next has to compile it rather than treat it as a built dep.
  transpilePackages: ["@psx/shared"],
  serverExternalPackages: ["pdf-parse", "pdfjs-dist"],
  // pdfjs loads its worker through a runtime dynamic import, which file
  // tracing cannot see, so the worker is missing from the serverless bundle
  // and every PDF fails with "Setting up fake worker failed". Ship it
  // explicitly with the routes that read PDFs.
  outputFileTracingIncludes: {
    "/api/ingest/email": ["./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs"],
    "/api/import/sync-cash": ["./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs"],
    "/api/import/upload": ["./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs"],
  },
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
