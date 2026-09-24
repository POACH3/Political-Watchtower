import { randomUUID } from "node:crypto";
import { createCollectedItem } from "@/lib/services/collected-items";

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

/**
 * A fresh CollectedItem with a unique payload (and therefore a unique
 * content hash — the service computes it), for tests that just need a
 * valid `source_item` to point at.
 */
export async function makeSourceItem(): Promise<string> {
  return createCollectedItem({
    collectorType: "manual_upload",
    collectorId: "test",
    sourceUrl: "https://example.com",
    submittedBy: "test",
    contentType: "application/json",
    rawPayload: JSON.stringify({ nonce: randomUUID() }),
  });
}
