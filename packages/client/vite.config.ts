import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { VitePWA } from "vite-plugin-pwa";
import basicSsl from "@vitejs/plugin-basic-ssl";
import { resolve } from "path";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    svelte(),
    basicSsl(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "apple-touch-icon.svg", "icons/*.png"],
      manifest: {
        name: "notapipe",
        short_name: "notapipe",
        description: "Ephemeral peer-to-peer text sharing — no server, no trace",
        theme_color: "#f5f0e8",
        background_color: "#f5f0e8",
        display: "standalone",
        orientation: "any",
        start_url: "/",
        icons: [
          {
            src: "icons/icon-192x192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "icons/icon-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "icons/icon-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
          {
            src: "favicon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,woff2}", "icons/*.png"],
        navigateFallback: "index.html",
        navigateFallbackDenylist: [/^\/ws/],
      },
    }),
  ],
  resolve: {
    alias: {
      $lib: resolve(__dirname, "src/lib"),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    open: true,
    host: true,
    proxy: {
      "/ws": {
        target: "ws://localhost:3001",
        ws: true,
      },
    },
  },
});
