import { runMigrations } from "./run-migrations";

// Unlike Next.js (which auto-loads .env for `next dev`/`next build`) and
// vitest.config.mts, this script has no framework loading .env for it —
// running it standalone (`npm run db:migrate`) previously only worked if
// DATABASE_URL happened to already be set in the shell, silently using
// the wrong connection (postgres' own OS-user/localhost defaults, not an
// error) otherwise. Load it explicitly instead of relying on that.
// (process.loadEnvFile never overrides a variable that's already set, so
// a container's own DATABASE_URL still wins over .env.)
try {
  process.loadEnvFile();
} catch {
  // no .env present — fine in CI, where DATABASE_URL is already set
}

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set");
}

await runMigrations(process.env.DATABASE_URL);

console.log("Migrations applied.");
