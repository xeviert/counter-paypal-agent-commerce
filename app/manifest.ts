import type { MetadataRoute } from "next";

/** Installable maker app (BUILDOUT §6.1). No service worker: Android installs without one, iOS via Share. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Counter for makers",
    short_name: "Counter",
    description: "Sell your work to buyers' AI agents. Get paid with PayPal.",
    start_url: "/s",
    scope: "/s",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#171717",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
