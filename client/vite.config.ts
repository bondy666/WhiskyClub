import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
  registerType: "autoUpdate",
  devOptions: {
    enabled: false
  },
  workbox: {
    cleanupOutdatedCaches: true,
    navigateFallbackDenylist: [
      /^\/api\//,
      /^\/.auth\//
    ],
    runtimeCaching: [
      {
        urlPattern: ({ url }) => url.pathname.startsWith("/api/"),
        handler: "NetworkOnly",
        method: "GET"
      },
      {
        urlPattern: ({ url }) => url.pathname.startsWith("/.auth/"),
        handler: "NetworkOnly",
        method: "GET"
      }
    ]
  },
  manifest: {
    name: "Ealing Whisky Guild",
    short_name: "EWG",
    description: "Whisky tasting, scoring and rankings",
    theme_color: "#7b3f00",
    background_color: "#e4d4bd",
    display: "standalone",
    start_url: "/",
    scope: "/",
    icons: [
      {
        src: "/pwa-192x192.png",
        sizes: "192x192",
        type: "image/png"
      },
      {
        src: "/pwa-512x512.png",
        sizes: "512x512",
        type: "image/png"
      }
    ]
  }
})
  ]
});