import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    exclude: ["node_modules/**", "dist/**", "tests/e2e/**"],
    pool: "threads",
    poolOptions: { threads: { singleThread: true } },
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      reportsDirectory: "coverage",
      include: ["src/**/*.{js,jsx}"],
      exclude: ["src/main.jsx", "src/**/*.test.{js,jsx}"],
      thresholds: {
        statements: 34,
        branches: 64,
        functions: 64,
        lines: 34,
      },
    },
    setupFiles: ["./src/test/setup.js"],
  },
  server: {
    host: "127.0.0.1",
    port: 4173,
  },
  preview: {
    host: "127.0.0.1",
    port: 4174,
  },
});
