// Tests run against their own throwaway database, never the dev one: they
// write rows they never clean up, and a shared DB made every run depend on
// whatever earlier runs (or manual poking) left behind.

export function resolveTestDatabaseUrl(): string {
  if (process.env.TEST_DATABASE_URL) return assertTestName(process.env.TEST_DATABASE_URL);

  const base = process.env.DATABASE_URL;
  if (!base) throw new Error("Set DATABASE_URL (or TEST_DATABASE_URL) to run the test suite.");

  const url = new URL(base);
  const name = url.pathname.replace(/^\//, "");
  url.pathname = `/${name.endsWith("_test") ? name : `${name}_test`}`;
  return assertTestName(url.toString());
}

// The global setup DROPs this database — refuse anything that doesn't
// announce itself as disposable.
function assertTestName(raw: string): string {
  const name = new URL(raw).pathname.replace(/^\//, "");
  if (!name.endsWith("_test")) {
    throw new Error(`Refusing to use database "${name}" for tests: its name must end in "_test".`);
  }
  return raw;
}

/** Same server, the always-present `postgres` maintenance database. */
export function maintenanceUrl(testUrl: string): string {
  const url = new URL(testUrl);
  url.pathname = "/postgres";
  return url.toString();
}
