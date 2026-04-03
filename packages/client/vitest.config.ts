import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: false,
  },
  resolve: {
    alias: {
      $lib: resolve(__dirname, "src/lib"),
    },
  },
});
