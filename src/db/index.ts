import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// The service layer (decision #4) is the only thing that should import
// this — presenters, collectors, and processors call named service
// functions, never the database directly.
//
// Cached on globalThis outside production: Next's dev server re-evaluates
// modules on hot reload, and a fresh `postgres()` per evaluation leaks a
// connection pool each time until Postgres runs out of connections.
const globalForDb = globalThis as unknown as { pgClient?: ReturnType<typeof postgres> };

const client = globalForDb.pgClient ?? postgres(process.env.DATABASE_URL!);
if (process.env.NODE_ENV !== "production") globalForDb.pgClient = client;

export const db = drizzle(client, { schema });
