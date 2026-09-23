// Service layer — see SPEC.md cross-cutting decision #5/#8: every module
// (presenters, collectors, processors) calls these, never the database
// directly. Signatures are plain/JSON-serializable on purpose, so a
// future non-TypeScript module could reach the same logic through a thin
// HTTP wrapper without these functions changing shape.

import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { collectedItems } from "@/db/schema";

export interface CreateCollectedItemInput {
  collectorType: "manual_upload" | "api_poll" | "crawl";
  collectorId: string;
  sourceUrl: string;
  submittedBy: string;
  sourceTimestamp?: string;
  contentHash: string;
  contentType: string;
  // The original fetched text, verbatim — a raw JSON API response body,
  // raw HTML, etc. Not a JS object to be serialized here: re-serializing
  // (even via JSON.stringify) can reorder/reformat and stop being
  // byte-identical to what was actually fetched, which is exactly the
  // problem storing this as jsonb had. Callers keep the original text
  // (e.g. `await response.text()`, not `await response.json()`).
  rawPayload: string;
}

/**
 * Returns the existing row's id on an exact-dedup hit (contentHash +
 * sourceUrl) instead of erroring or creating a duplicate — "Data
 * collector architecture" describes this check as the aggregator's job;
 * previously this was a bare INSERT with no dedup logic at all.
 */
export async function createCollectedItem(input: CreateCollectedItemInput): Promise<string> {
  const [row] = await db
    .insert(collectedItems)
    .values({
      collectorType: input.collectorType,
      collectorId: input.collectorId,
      sourceUrl: input.sourceUrl,
      submittedBy: input.submittedBy,
      sourceTimestamp: input.sourceTimestamp ? new Date(input.sourceTimestamp) : undefined,
      contentHash: input.contentHash,
      contentType: input.contentType,
      rawPayload: input.rawPayload,
    })
    .onConflictDoUpdate({
      target: [collectedItems.contentHash, collectedItems.sourceUrl],
      // No-op update (touches nothing) rather than DO NOTHING, purely so
      // `.returning()` still yields a row on a dedup hit — Postgres
      // doesn't return anything for a skipped DO NOTHING conflict.
      set: { contentHash: sql`${collectedItems.contentHash}` },
    })
    .returning({ id: collectedItems.id });

  return row.id;
}

export async function findCollectedItemByHash(
  contentHash: string,
  sourceUrl: string,
): Promise<string | null> {
  const [row] = await db
    .select({ id: collectedItems.id })
    .from(collectedItems)
    .where(and(eq(collectedItems.contentHash, contentHash), eq(collectedItems.sourceUrl, sourceUrl)))
    .limit(1);

  return row?.id ?? null;
}
