import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { chambers, districts, politicianExternalIds, terms } from "@/db/schema";
import { createCollectedItem } from "@/lib/services/collected-items";
import { upsertJurisdiction } from "@/lib/services/jurisdictions";
import { upsertPoliticianByExternalId } from "@/lib/services/politicians";
import { pgErrorMessage } from "@/lib/test-utils";

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

describe("Term — no-overlap exclusion constraint", () => {
  let politicianId: string;
  let jurisdictionId: string;
  let chamberId: string;
  let districtId: string;
  let sourceItem: string;

  beforeAll(async () => {
    sourceItem = await makeSourceItem();
    jurisdictionId = await upsertJurisdiction({
      slug: `test-term-overlap-${randomUUID()}`,
      name: "Test Jurisdiction",
      level: "state",
    });
    politicianId = await upsertPoliticianByExternalId({
      jurisdictionId,
      externalId: randomUUID(),
      sourceItem,
      fullName: "Overlap Test Politician",
    });

    const [chamber] = await db
      .insert(chambers)
      .values({ jurisdictionId, slug: "house", name: "House" })
      .returning({ id: chambers.id });
    chamberId = chamber.id;

    const [district] = await db
      .insert(districts)
      .values({
        jurisdictionId,
        chamberId,
        externalDistrictId: "D1",
        validFrom: "2020-01-01",
      })
      .returning({ id: districts.id });
    districtId = district.id;
  });

  it("rejects a second open-ended term for the same politician+chamber that starts before the first one ends", async () => {
    await db.insert(terms).values({
      politicianId,
      jurisdictionId,
      chamberId,
      districtId,
      party: "Independent",
      startDate: "2023-01-01",
      sourceItem,
    });

    const error = await db
      .insert(terms)
      .values({
        politicianId,
        jurisdictionId,
        chamberId,
        districtId,
        party: "Independent",
        startDate: "2025-01-01",
        sourceItem,
      })
      .catch((e) => e);

    expect(pgErrorMessage(error)).toMatch(
      /conflicting key value violates exclusion constraint "terms_no_overlap"/,
    );
  });

  it("allows a second term that starts after the first one's end_date", async () => {
    const politician2 = await upsertPoliticianByExternalId({
      jurisdictionId,
      externalId: randomUUID(),
      sourceItem,
      fullName: "Non-overlap Test Politician",
    });

    await db.insert(terms).values({
      politicianId: politician2,
      jurisdictionId,
      chamberId,
      districtId,
      party: "Independent",
      startDate: "2019-01-01",
      endDate: "2022-12-31",
      sourceItem,
    });

    await expect(
      db.insert(terms).values({
        politicianId: politician2,
        jurisdictionId,
        chamberId,
        districtId,
        party: "Independent",
        startDate: "2023-01-01",
        sourceItem,
      }),
    ).resolves.not.toThrow();
  });
});

describe("PoliticianExternalId — unique (jurisdiction_id, external_id)", () => {
  it("rejects a duplicate external_id within the same jurisdiction", async () => {
    const sourceItem = await makeSourceItem();
    const jurisdictionId = await upsertJurisdiction({
      slug: `test-dedup-${randomUUID()}`,
      name: "Test Jurisdiction",
      level: "state",
    });
    const externalId = randomUUID();

    await db.insert(politicianExternalIds).values({
      politicianId: await upsertPoliticianByExternalId({
        jurisdictionId,
        externalId: randomUUID(),
        sourceItem,
        fullName: "First",
      }),
      jurisdictionId,
      externalId,
    });

    const error = await db
      .insert(politicianExternalIds)
      .values({
        politicianId: await upsertPoliticianByExternalId({
          jurisdictionId,
          externalId: randomUUID(),
          sourceItem,
          fullName: "Second",
        }),
        jurisdictionId,
        externalId,
      })
      .catch((e) => e);

    expect(pgErrorMessage(error)).toMatch(/duplicate key value violates unique constraint/);
  });
});
