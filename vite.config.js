import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    manifest: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules") && id.includes("@supabase")) return "supabase";
        },
      },
    },
  },
  test: {
    exclude: ["node_modules/**", "dist/**", "tests/e2e/**"],
    pool: "threads",
    maxWorkers: 1,
    testTimeout: 15000,
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      reportsDirectory: "coverage",
      include: ["src/**/*.{js,jsx}"],
      exclude: ["src/main.jsx", "src/**/*.test.{js,jsx}"],
      thresholds: {
        statements: 58,
        branches: 52,
        functions: 52,
        lines: 60,
        "src/domain/**": { statements: 85, branches: 75, functions: 90, lines: 90 },
        "src/crypto/**": { statements: 90, branches: 75, functions: 90, lines: 95 },
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
