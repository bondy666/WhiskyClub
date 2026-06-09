VitePWA({
  registerType: "autoUpdate",
  includeAssets: ["favicon.svg"],
  workbox: {
    cleanupOutdatedCaches: true,
    navigateFallbackDenylist: [
      /^\/api\//,
      /^\/.auth\//
    ],
    runtimeCaching: [
      {
        urlPattern: /^.*\/api\/.*$/,
        handler: "NetworkOnly",
        method: "GET"
      },
      {
        urlPattern: /^.*\/.auth\/.*$/,
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
    background_color: "#efe7da",
    display: "standalone",
    start_url: "/",
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