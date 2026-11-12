import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vitest/config";
import { VitePWA } from "vite-plugin-pwa";
import pkg from "./package.json" with { type: "json" };

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // "prompt": a new version waits until the person agrees, so an update never lands in the middle of a purchase.
      registerType: "prompt",
      injectRegister: false,
      manifest: {
        name: "Gilded",
        short_name: "Gilded",
        description: "Gold buying and valuation, online or offline.",
        theme_color: "#0d1b2e",
        background_color: "#0d1b2e",
        display: "standalone",
        start_url: "/",
        scope: "/",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "/icon-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        // The whole app (code, fonts, sounds, images) is stored on first visit, so it opens with no connection.
        globPatterns: [
          "**/*.{js,css,html,svg,png,mp3,woff2,woff,ico,webmanifest}",
        ],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallback: "/index.html",
        // /updates is the desktop installer folder: the browser must ask the server for it, never get the app page back.
        navigateFallbackDenylist: [
          /^\/api\//,
          /^\/hubs\//,
          /^\/health/,
          /^\/updates\//,
        ],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: { host: true, port: 5173 },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
