import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

if (existsSync(".env")) process.loadEnvFile(".env");
const { TEST_DATABASE_URL } = process.env;

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  test: {
    include: ["**/*.test.ts"],
    exclude: ["node_modules/**", ".next/**"],
    env: TEST_DATABASE_URL ? { TEST_DATABASE_URL } : {},
  },
});
