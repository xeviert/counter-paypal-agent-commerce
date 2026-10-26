import { existsSync } from "node:fs";
import { defineConfig } from "drizzle-kit";

if (existsSync(".env")) process.loadEnvFile(".env");

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");

export default defineConfig({
  dialect: "postgresql",
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url },
  strict: true,
});
