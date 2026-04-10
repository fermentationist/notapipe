import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    exclude: ["**/e2e/**", "**/node_modules/**"],
  },
  resolve: {
    alias: {
      $lib: resolve(__dirname, "packages/client/src/lib"),
    },
  },
});
