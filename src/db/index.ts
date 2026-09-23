import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// The service layer (decision #5/#8) is the only thing that should
// import this — presenters, collectors, and processors call named
// service functions, never the database directly.
const client = postgres(process.env.DATABASE_URL!);

export const db = drizzle(client, { schema });
