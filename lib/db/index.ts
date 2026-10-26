import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getEnv } from "@/lib/env";
import * as schema from "./schema";

function connect(url: string) {
  return drizzle(postgres(url, { max: 10, connect_timeout: 5, onnotice: () => {} }), { schema });
}

export type Db = ReturnType<typeof connect>;

// Cached on globalThis so dev hot reloads reuse one pool.
const globalForDb = globalThis as unknown as { db?: Db };

export function getDb(): Db {
  globalForDb.db ??= connect(getEnv().DATABASE_URL);
  return globalForDb.db;
}

export function createDb(url: string): Db {
  return connect(url);
}

export { schema };
