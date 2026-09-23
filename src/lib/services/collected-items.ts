// Service layer — see SPEC.md cross-cutting decision #5/#8: every module
// (presenters, collectors, processors) calls these, never the database
// directly. Signatures are plain/JSON-serializable on purpose, so a
// future non-TypeScript module could reach the same logic through a thin
// HTTP wrapper without these functions changing shape.

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
  rawPayload: unknown;
}

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
    .returning({ id: collectedItems.id });

  return row.id;
}
