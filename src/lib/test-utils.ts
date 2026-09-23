/**
 * Drizzle wraps the real Postgres error in a DrizzleQueryError whose
 * top-level `.message` is just "Failed query: <sql>..." — the actual
 * Postgres error text (what a constraint-violation test actually wants
 * to assert on) lives on `.cause`.
 */
export function pgErrorMessage(error: unknown): string {
  const cause = (error as { cause?: unknown })?.cause;
  if (cause instanceof Error) return cause.message;
  return error instanceof Error ? error.message : String(error);
}
