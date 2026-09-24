import postgres from "postgres";
import { runMigrations } from "./src/db/run-migrations";
import { maintenanceUrl, resolveTestDatabaseUrl } from "./vitest.test-db";

// Recreates the test database from scratch and migrates it, once per
// `vitest run`. A fresh database per run is also what makes it safe for
// tests to leave rows behind.
export default async function setup() {
  const testUrl = resolveTestDatabaseUrl();
  const dbName = new URL(testUrl).pathname.replace(/^\//, "");

  const admin = postgres(maintenanceUrl(testUrl), { max: 1, onnotice: () => {} });
  try {
    // Identifier is validated above (must end in _test); still quote it.
    const ident = `"${dbName.replace(/"/g, '""')}"`;
    await admin.unsafe(`DROP DATABASE IF EXISTS ${ident} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${ident}`);
  } finally {
    await admin.end();
  }

  await runMigrations(testUrl);
}
