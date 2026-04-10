import { defineWorkspace } from "vitest/node";

export default defineWorkspace([
  "packages/client/vitest.config.ts",
  "packages/signalling/vitest.config.ts",
]);
