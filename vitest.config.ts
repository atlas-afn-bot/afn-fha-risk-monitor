import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: [
      "src/**/*.{test,spec}.{ts,tsx}",
      "api/lib/__tests__/*.{test,spec}.{js,ts}",
    ],
    // Evaluator + predicate tests run in Node (no jsdom). Match by path so
    // the React tests still get a DOM.
    environmentMatchGlobs: [
      ["api/**", "node"],
    ],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
