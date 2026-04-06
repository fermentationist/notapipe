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
      includeAssets: ["favicon.svg"],
      manifest: {
        name: "notapipe",
        short_name: "notapipe",
        description: "Ephemeral peer-to-peer text sharing — no server, no trace",
        theme_color: "#f5f0e8",
        background_color: "#f5f0e8",
        display: "standalone",
        orientation: "portrait-primary",
        start_url: "/",
        icons: [
          {
            src: "favicon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any",
          },
        ],
      },
      workbox: {
        // Precache all compiled assets
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        // Serve index.html for all navigation (SPA routing)
        navigateFallback: "index.html",
        // Don't intercept WebSocket upgrade requests
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
