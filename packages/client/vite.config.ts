import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { VitePWA } from "vite-plugin-pwa";
import mkcert from "vite-plugin-mkcert";
import { resolve } from "path";
import { createReadStream, existsSync } from "fs";

// Base path for asset references.
// Set VITE_BASE_PATH=/notapipe for GitHub Pages subdirectory deployment.
// Leave unset for root deployment (Render, custom domain).
const raw_base = process.env["VITE_BASE_PATH"] ?? "/";
const base = raw_base.endsWith("/") ? raw_base : `${raw_base}/`;

// https://vite.dev/config/
export default defineConfig({
  base,
  plugins: [
    // Dev-only: serve public/info/index.html for /info and /info/ before the
    // SPA history fallback can intercept them.
    {
      name: "serve-info-page",
      configureServer(server) {
        const info_file = resolve(__dirname, "public/info/index.html");
        server.middlewares.use((req, res, next) => {
          if (req.url === "/info" || req.url === "/info/") {
            if (existsSync(info_file)) {
              res.setHeader("Content-Type", "text/html; charset=utf-8");
              createReadStream(info_file).pipe(res);
              return;
            }
          }
          next();
        });
      },
    },
    svelte(),
    mkcert(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["app_icons/*.png"],
      manifest: {
        name: "notapipe",
        short_name: "notapipe",
        description: "Ephemeral peer-to-peer text sharing — no server, no trace",
        theme_color: "#f5f0e8",
        background_color: "#f5f0e8",
        display: "standalone",
        orientation: "any",
        scope: base,
        start_url: base,
        icons: [
          {
            src: "app_icons/icon-192x192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "app_icons/icon-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "app_icons/icon-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
        launch_handler: {
          client_mode: ["focus-existing", "navigate-new"],
        },
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,woff2}", "app_icons/*.png"],
        navigateFallback: `${base}index.html`,
        navigateFallbackAllowlist: [/^\//],
        navigateFallbackDenylist: [/^\/ws/, /^\/info/, /^\/videos\//],
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
