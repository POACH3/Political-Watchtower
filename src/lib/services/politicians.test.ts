import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { politicians } from "@/db/schema";
import { pgErrorMessage } from "@/lib/test-utils";
import { createCollectedItem } from "./collected-items";
import { upsertJurisdiction } from "./jurisdictions";
import { getPoliticianProfile, upsertPoliticianByExternalId } from "./politicians";

async function makeSourceItem(): Promise<string> {
  return createCollectedItem({
    collectorType: "manual_upload",
    collectorId: "test",
    sourceUrl: "https://example.com",
    submittedBy: "test",
    contentHash: randomUUID(),
    contentType: "application/json",
    rawPayload: {},
  });
}

describe("Stage 1 — provenance constraint", () => {
  it("rejects a politician with no source_item at the database layer", async () => {
    const error = await db
      .execute(sql`INSERT INTO politicians (full_name) VALUES ('No Source')`)
      .catch((e) => e);

    expect(pgErrorMessage(error)).toMatch(/null value in column "source_item"/);
  });
});

describe("Stage 1 — upsertPoliticianByExternalId", () => {
  let jurisdictionId: string;

  beforeAll(async () => {
    jurisdictionId = await upsertJurisdiction({
      slug: `test-jurisdiction-${randomUUID()}`,
      name: "Test Jurisdiction",
      level: "state",
    });
  });

  it("creates a placeholder name when none is given yet", async () => {
    const sourceItem = await makeSourceItem();
    const externalId = randomUUID();

    const id = await upsertPoliticianByExternalId({ jurisdictionId, externalId, sourceItem });
    const profile = await getPoliticianProfile(id);

    expect(profile?.fullName).toBe(`Unnamed (external_id: ${externalId})`);
  });

  it("does not create a second politician for the same jurisdiction+externalId", async () => {
    const sourceItem = await makeSourceItem();
    const externalId = randomUUID();

    const firstId = await upsertPoliticianByExternalId({ jurisdictionId, externalId, sourceItem });
    const secondId = await upsertPoliticianByExternalId({ jurisdictionId, externalId, sourceItem });

    expect(secondId).toBe(firstId);
  });

  it("overwrites the placeholder once a real name syncs in", async () => {
    const sourceItem = await makeSourceItem();
    const externalId = randomUUID();

    const id = await upsertPoliticianByExternalId({ jurisdictionId, externalId, sourceItem });
    await upsertPoliticianByExternalId({
      jurisdictionId,
      externalId,
      sourceItem,
      fullName: "Real Name",
    });

    const profile = await getPoliticianProfile(id);
    expect(profile?.fullName).toBe("Real Name");
  });

  it("does not overwrite an already-real name with a later placeholder-less call", async () => {
    const sourceItem = await makeSourceItem();
    const externalId = randomUUID();

    const id = await upsertPoliticianByExternalId({
      jurisdictionId,
      externalId,
      sourceItem,
      fullName: "Real Name",
    });
    await upsertPoliticianByExternalId({ jurisdictionId, externalId, sourceItem });

    const profile = await getPoliticianProfile(id);
    expect(profile?.fullName).toBe("Real Name");
  });
});

describe("Stage 1 — Politician.fullName required", () => {
  it("rejects a politician with no full_name", async () => {
    const sourceItem = await makeSourceItem();
    await expect(
      db.insert(politicians).values({ sourceItem } as never),
    ).rejects.toThrow();
  });
});
