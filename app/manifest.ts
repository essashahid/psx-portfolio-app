import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "PortfolioOS PK",
    short_name: "PortfolioOS",
    description: "Private PSX portfolio command center",
    start_url: "/",
    display: "standalone",
    background_color: "#f2f2f0",
    theme_color: "#f2f2f0",
    icons: [
      {
        src: "/icons/icon-192x192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512x512.png",
        sizes: "512x512",
        type: "image/png",
        // Was declared maskable, but the mark reaches the edge of this frame,
        // so a launcher applying a circular mask cut into it. The maskable
        // build below is the one drawn inside the 80% safe circle.
        purpose: "any",
      },
      {
        src: "/icons/maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
