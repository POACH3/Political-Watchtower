import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

// Unlike Next.js (which auto-loads .env for `next dev`/`next build`) and
// vitest.config.mts, this script has no framework loading .env for it —
// running it standalone (`npm run db:migrate`) previously only worked if
// DATABASE_URL happened to already be set in the shell, silently using
// the wrong connection (postgres' own OS-user/localhost defaults, not an
// error) otherwise. Load it explicitly instead of relying on that.
try {
  process.loadEnvFile();
} catch {
  // no .env present — fine in CI, where DATABASE_URL is already set
}

const client = postgres(process.env.DATABASE_URL!, { max: 1 });
const db = drizzle(client);

await migrate(db, { migrationsFolder: "./src/db/migrations" });
await client.end();

console.log("Migrations applied.");
