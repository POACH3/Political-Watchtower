import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { politicians } from "@/db/schema";
import { makeSourceItem, pgErrorMessage } from "@/lib/test-utils";
import { upsertJurisdiction } from "./jurisdictions";
import { getPoliticianProfile, upsertPoliticianByExternalId } from "./politicians";

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

// Kept current by a BEFORE UPDATE trigger (migrations/0002_updated_at_trigger.sql),
// not application code — see src/db/schema/_shared.ts. Politician is just
// one of the tables the trigger is attached to; this proves the
// mechanism itself works rather than re-testing it per table.
describe("Stage 1 — updated_at trigger", () => {
  it("bumps updated_at on UPDATE, independent of application code", async () => {
    const sourceItem = await makeSourceItem();
    const jurisdictionId = await upsertJurisdiction({
      slug: `test-updated-at-${randomUUID()}`,
      name: "Test Jurisdiction",
      level: "state",
    });
    const id = await upsertPoliticianByExternalId({
      jurisdictionId,
      externalId: randomUUID(),
      sourceItem,
      fullName: "Before Update",
    });

    const [before] = await db
      .select({ updatedAt: politicians.updatedAt })
      .from(politicians)
      .where(sql`${politicians.id} = ${id}`);

    await new Promise((resolve) => setTimeout(resolve, 10));

    // A raw SQL UPDATE, not a Drizzle .$onUpdate() write — proves the
    // trigger fires regardless of write path, not just ORM writes.
    await db.execute(sql`UPDATE politicians SET full_name = 'After Update' WHERE id = ${id}`);

    const [after] = await db
      .select({ updatedAt: politicians.updatedAt })
      .from(politicians)
      .where(sql`${politicians.id} = ${id}`);

    expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
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
