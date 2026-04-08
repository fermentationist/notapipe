import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { VitePWA } from "vite-plugin-pwa";
import basicSsl from "@vitejs/plugin-basic-ssl";
import { resolve } from "path";

// Base path for asset references.
// Set VITE_BASE_PATH=/notapipe for GitHub Pages subdirectory deployment.
// Leave unset for root deployment (Render, custom domain).
const raw_base = process.env["VITE_BASE_PATH"] ?? "/";
const base = raw_base.endsWith("/") ? raw_base : `${raw_base}/`;

// https://vite.dev/config/
export default defineConfig({
  base,
  plugins: [
    svelte(),
    basicSsl(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icons/*.png"],
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
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,woff2}", "icons/*.png"],
        navigateFallback: "index.html",
        navigateFallbackDenylist: [/^\/ws/],
      },
      devOptions: {
        enabled: true,
        type: "module",
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
