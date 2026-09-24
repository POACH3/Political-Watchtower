import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { db } from "@/db";
import { collectedItems } from "@/db/schema";
import { hashPayload } from "@/lib/normalize";
import { eq } from "drizzle-orm";
import { createCollectedItem, findCollectedItemByHash } from "./collected-items";

function input(overrides: Partial<Parameters<typeof createCollectedItem>[0]> = {}) {
  return {
    collectorType: "manual_upload" as const,
    collectorId: "test",
    sourceUrl: `https://example.com/${randomUUID()}`,
    submittedBy: "test",
    contentType: "application/json",
    rawPayload: JSON.stringify({ nonce: randomUUID() }),
    ...overrides,
  };
}

// "Validation & acceptance criteria" — exact-dedup on (content_hash,
// source_url), backed by collected_items' UNIQUE constraint. Previously
// this table had no uniqueness at all, so re-fetching the same content
// silently created duplicate rows.
describe("createCollectedItem — exact-dedup via (content_hash, source_url)", () => {
  it("returns the same row id when called twice with the same payload and URL", async () => {
    const base = input();
    const firstId = await createCollectedItem(base);
    const secondId = await createCollectedItem(base);
    expect(secondId).toBe(firstId);
  });

  it("creates a distinct row when the same payload appears at a different source_url", async () => {
    const rawPayload = JSON.stringify({ nonce: randomUUID() });
    const firstId = await createCollectedItem(input({ rawPayload }));
    const secondId = await createCollectedItem(input({ rawPayload }));
    expect(secondId).not.toBe(firstId);
  });

  it("computes content_hash itself from rawPayload, rather than trusting a caller", async () => {
    const base = input();
    const id = await createCollectedItem(base);
    const [row] = await db.select().from(collectedItems).where(eq(collectedItems.id, id));
    expect(row.contentHash).toBe(hashPayload(base.rawPayload));
  });

  it("treats URLs differing only by case/fragment as the same source", async () => {
    const rawPayload = JSON.stringify({ nonce: randomUUID() });
    const path = randomUUID();
    const firstId = await createCollectedItem(input({ rawPayload, sourceUrl: `https://Example.com/${path}#a` }));
    const secondId = await createCollectedItem(input({ rawPayload, sourceUrl: `https://example.com/${path}` }));
    expect(secondId).toBe(firstId);
  });

  it("does not bump updated_at on an unchanged re-poll", async () => {
    const base = input();
    const id = await createCollectedItem(base);
    const [before] = await db.select().from(collectedItems).where(eq(collectedItems.id, id));
    await createCollectedItem(base);
    const [after] = await db.select().from(collectedItems).where(eq(collectedItems.id, id));
    expect(after.updatedAt).toEqual(before.updatedAt);
  });
});

describe("findCollectedItemByHash", () => {
  it("finds an existing row by (content_hash, source_url)", async () => {
    const base = input();
    const id = await createCollectedItem(base);
    await expect(findCollectedItemByHash(hashPayload(base.rawPayload), base.sourceUrl)).resolves.toBe(id);
  });

  it("returns null when no row matches", async () => {
    await expect(findCollectedItemByHash(randomUUID(), "https://example.com/nothing")).resolves.toBeNull();
  });
});
