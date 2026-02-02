import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["crypto/**/*.test.ts"],
    exclude: ["node_modules/**"],
  },
});
