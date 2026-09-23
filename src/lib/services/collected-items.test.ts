import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createCollectedItem, findCollectedItemByHash } from "./collected-items";

// "Validation & acceptance criteria" — exact-dedup on (content_hash,
// source_url), backed by collected_items' UNIQUE constraint. Previously
// this table had no uniqueness at all, so re-fetching the same content
// silently created duplicate rows.
describe("createCollectedItem — exact-dedup via (content_hash, source_url)", () => {
  it("returns the same row id when called twice with the same hash and URL", async () => {
    const contentHash = randomUUID();
    const sourceUrl = `https://example.com/${randomUUID()}`;

    const firstId = await createCollectedItem({
      collectorType: "manual_upload",
      collectorId: "test",
      sourceUrl,
      submittedBy: "test",
      contentHash,
      contentType: "application/json",
      rawPayload: "{}",
    });

    const secondId = await createCollectedItem({
      collectorType: "manual_upload",
      collectorId: "test",
      sourceUrl,
      submittedBy: "test",
      contentHash,
      contentType: "application/json",
      rawPayload: "{}",
    });

    expect(secondId).toBe(firstId);
  });

  it("creates a distinct row when the same hash appears at a different source_url", async () => {
    const contentHash = randomUUID();

    const firstId = await createCollectedItem({
      collectorType: "manual_upload",
      collectorId: "test",
      sourceUrl: `https://example.com/${randomUUID()}`,
      submittedBy: "test",
      contentHash,
      contentType: "application/json",
      rawPayload: "{}",
    });

    const secondId = await createCollectedItem({
      collectorType: "manual_upload",
      collectorId: "test",
      sourceUrl: `https://example.com/${randomUUID()}`,
      submittedBy: "test",
      contentHash,
      contentType: "application/json",
      rawPayload: "{}",
    });

    expect(secondId).not.toBe(firstId);
  });
});

describe("findCollectedItemByHash", () => {
  it("finds an existing row by (content_hash, source_url)", async () => {
    const contentHash = randomUUID();
    const sourceUrl = `https://example.com/${randomUUID()}`;

    const id = await createCollectedItem({
      collectorType: "manual_upload",
      collectorId: "test",
      sourceUrl,
      submittedBy: "test",
      contentHash,
      contentType: "application/json",
      rawPayload: "{}",
    });

    await expect(findCollectedItemByHash(contentHash, sourceUrl)).resolves.toBe(id);
  });

  it("returns null when no row matches", async () => {
    await expect(findCollectedItemByHash(randomUUID(), "https://example.com/nothing")).resolves.toBeNull();
  });
});
