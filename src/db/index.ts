import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "DATABASE_URL is not set. Copy .env.example to .env and point it at your Postgres instance.",
  );
}

// Reuse a single client across hot-reloads in dev so we don't exhaust
// connections. In production a fresh module load gets a fresh pool.
const globalForDb = globalThis as unknown as {
  __sddClient?: ReturnType<typeof postgres>;
};

const client =
  globalForDb.__sddClient ?? postgres(connectionString, { max: 10 });

if (process.env.NODE_ENV !== "production") {
  globalForDb.__sddClient = client;
}

export const db = drizzle(client, { schema });
export { schema };
