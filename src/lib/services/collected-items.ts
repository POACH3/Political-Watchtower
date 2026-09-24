// Service layer — see SPEC.md cross-cutting decision #4: every module
// (presenters, collectors, processors) calls these, never the database
// directly. Signatures are plain/JSON-serializable on purpose, so a
// future non-TypeScript module could reach the same logic through a thin
// HTTP wrapper without these functions changing shape.

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { collectedItems } from "@/db/schema";
import { hashPayload, normalizeUrl } from "@/lib/normalize";

export interface CreateCollectedItemInput {
  collectorType: "manual_upload" | "api_poll" | "crawl";
  collectorId: string;
  sourceUrl: string;
  submittedBy: string;
  sourceTimestamp?: string;
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
 * Returns the existing row's id on an exact-dedup hit instead of
 * erroring or creating a duplicate — "Data collector architecture"
 * describes this check as the aggregator's job.
 *
 * The dedup key is (sha-256 of rawPayload, normalized sourceUrl). Both
 * halves are computed here, not trusted from the caller: a caller-supplied
 * hash could silently disagree with the payload it's supposed to be an
 * integrity check over.
 */
export async function createCollectedItem(input: CreateCollectedItemInput): Promise<string> {
  const contentHash = hashPayload(input.rawPayload);
  const sourceUrl = normalizeUrl(input.sourceUrl);

  const [inserted] = await db
    .insert(collectedItems)
    .values({
      collectorType: input.collectorType,
      collectorId: input.collectorId,
      sourceUrl,
      submittedBy: input.submittedBy,
      sourceTimestamp: input.sourceTimestamp ? new Date(input.sourceTimestamp) : undefined,
      contentHash,
      contentType: input.contentType,
      rawPayload: input.rawPayload,
    })
    // DO NOTHING rather than a no-op DO UPDATE: the latter rewrites the
    // row (dead tuple + `updated_at` bump) on every unchanged re-poll.
    // A dedup hit returns nothing, so fall through to a select — under
    // READ COMMITTED that sees a concurrent writer's committed row.
    .onConflictDoNothing({ target: [collectedItems.contentHash, collectedItems.sourceUrl] })
    .returning({ id: collectedItems.id });

  if (inserted) return inserted.id;

  const existing = await findCollectedItemByHash(contentHash, sourceUrl);
  if (!existing) throw new Error("collected_items conflict reported but no existing row found");
  return existing;
}

export async function findCollectedItemByHash(
  contentHash: string,
  sourceUrl: string,
): Promise<string | null> {
  const [row] = await db
    .select({ id: collectedItems.id })
    .from(collectedItems)
    .where(
      and(eq(collectedItems.contentHash, contentHash), eq(collectedItems.sourceUrl, normalizeUrl(sourceUrl))),
    )
    .limit(1);

  return row?.id ?? null;
}
