import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import {
  bills,
  candidacies,
  chambers,
  claimResponses,
  claimSources,
  claims,
  committees,
  districts,
  elections,
  issueAreas,
  legislativeSessions,
  meetings,
  newsItemSources,
  newsItems,
  processorRuns,
  promiseEvidence,
  promiseSources,
  promises,
  terms,
  votes,
} from "@/db/schema";
import { upsertJurisdiction } from "@/lib/services/jurisdictions";
import { upsertPoliticianByExternalId } from "@/lib/services/politicians";
import { makeSourceItem, pgErrorMessage } from "@/lib/test-utils";

// Regression tests for the constraint gaps found in the schema review:
// each one was reproduced against the live schema (accepted a row it
// should have rejected) before being fixed, and stays here so a
// weakened constraint fails loudly instead of silently.

async function rejection(promise: PromiseLike<unknown>): Promise<string> {
  const error = await Promise.resolve(promise).then(
    () => null,
    (e) => e,
  );
  expect(error, "expected the database to reject this write").not.toBeNull();
  return pgErrorMessage(error);
}

async function makeNewsItem(): Promise<string> {
  const sourceItemId = await makeSourceItem();
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(newsItems)
      .values({
        platform: "news",
        canonicalUrl: `https://example.com/${randomUUID()}`,
        contentHash: randomUUID(),
        headlineOrText: "Test article",
      })
      .returning({ id: newsItems.id });
    await tx.insert(newsItemSources).values({ newsItemId: row.id, sourceItemId });
    return row.id;
  });
}

// Two chambers, one district in chamber A, one politician, one session.
async function makeWorld() {
  const sourceItem = await makeSourceItem();
  const jurisdictionId = await upsertJurisdiction({
    slug: `test-integrity-${randomUUID()}`,
    name: "Test Jurisdiction",
    level: "state",
  });
  const [chamberA] = await db
    .insert(chambers)
    .values({ jurisdictionId, slug: "a", name: "A" })
    .returning({ id: chambers.id });
  const [chamberB] = await db
    .insert(chambers)
    .values({ jurisdictionId, slug: "b", name: "B" })
    .returning({ id: chambers.id });
  const [districtA] = await db
    .insert(districts)
    .values({ chamberId: chamberA.id, externalDistrictId: "1", validFrom: "2020-01-01" })
    .returning({ id: districts.id });
  const [session] = await db
    .insert(legislativeSessions)
    .values({ jurisdictionId, externalSessionId: "s1", startDate: "2026-01-01" })
    .returning({ id: legislativeSessions.id });
  const politicianId = await upsertPoliticianByExternalId({
    jurisdictionId,
    externalId: randomUUID(),
    sourceItem,
    fullName: "Test Politician",
  });
  return {
    sourceItem,
    jurisdictionId,
    chamberA: chamberA.id,
    chamberB: chamberB.id,
    districtA: districtA.id,
    sessionId: session.id,
    politicianId,
  };
}

describe("Election — UNIQUE treats NULL chamber/district as equal", () => {
  it("rejects the same statewide race inserted twice", async () => {
    const w = await makeWorld();
    const race = {
      jurisdictionId: w.jurisdictionId,
      electionDate: "2026-11-03",
      electionType: "general" as const,
      sourceItem: w.sourceItem,
    };
    await db.insert(elections).values(race);
    expect(await rejection(db.insert(elections).values(race))).toMatch(/duplicate key|unique/i);
  });

  it("rejects a district with no chamber (would skip the composite FK)", async () => {
    const w = await makeWorld();
    const message = await rejection(
      db.insert(elections).values({
        jurisdictionId: w.jurisdictionId,
        districtId: w.districtA,
        electionDate: "2026-11-03",
        electionType: "general",
        sourceItem: w.sourceItem,
      }),
    );
    expect(message).toMatch(/elections_district_requires_chamber/);
  });

  it("rejects a chamber that belongs to a different jurisdiction", async () => {
    const w = await makeWorld();
    const other = await makeWorld();
    const message = await rejection(
      db.insert(elections).values({
        jurisdictionId: w.jurisdictionId,
        chamberId: other.chamberA,
        electionDate: "2026-11-03",
        electionType: "general",
        sourceItem: w.sourceItem,
      }),
    );
    expect(message).toMatch(/elections_chamber_in_jurisdiction_fk/);
  });
});

describe("Term — cross-table consistency and date order", () => {
  it("rejects a district that belongs to a different chamber than the term's", async () => {
    const w = await makeWorld();
    const message = await rejection(
      db.insert(terms).values({
        politicianId: w.politicianId,
        chamberId: w.chamberB,
        districtId: w.districtA,
        startDate: "2023-01-01",
        sourceItem: w.sourceItem,
      }),
    );
    expect(message).toMatch(/terms_district_in_chamber_fk/);
  });

  it("rejects a candidacy that belongs to a different politician", async () => {
    const w = await makeWorld();
    const [election] = await db
      .insert(elections)
      .values({
        jurisdictionId: w.jurisdictionId,
        chamberId: w.chamberA,
        districtId: w.districtA,
        electionDate: "2022-11-08",
        electionType: "general",
        sourceItem: w.sourceItem,
      })
      .returning({ id: elections.id });
    const otherPolitician = await upsertPoliticianByExternalId({
      jurisdictionId: w.jurisdictionId,
      externalId: randomUUID(),
      sourceItem: w.sourceItem,
      fullName: "Someone Else",
    });
    const [candidacy] = await db
      .insert(candidacies)
      .values({ politicianId: otherPolitician, electionId: election.id, sourceItem: w.sourceItem })
      .returning({ id: candidacies.id });

    const message = await rejection(
      db.insert(terms).values({
        politicianId: w.politicianId,
        chamberId: w.chamberA,
        districtId: w.districtA,
        candidacyId: candidacy.id,
        startDate: "2023-01-01",
        sourceItem: w.sourceItem,
      }),
    );
    expect(message).toMatch(/terms_candidacy_is_own_fk/);
  });

  it("rejects an end_date that is not after start_date", async () => {
    const w = await makeWorld();
    const message = await rejection(
      db.insert(terms).values({
        politicianId: w.politicianId,
        chamberId: w.chamberA,
        districtId: w.districtA,
        startDate: "2023-01-01",
        endDate: "2023-01-01",
        sourceItem: w.sourceItem,
      }),
    );
    expect(message).toMatch(/terms_dates_ordered/);
  });
});

describe("Date-order CHECKs", () => {
  it("rejects a session that ends before it starts", async () => {
    const w = await makeWorld();
    const message = await rejection(
      db.insert(legislativeSessions).values({
        jurisdictionId: w.jurisdictionId,
        externalSessionId: "backwards",
        startDate: "2026-05-01",
        endDate: "2020-01-01",
      }),
    );
    expect(message).toMatch(/legislative_sessions_dates_ordered/);
  });

  it("rejects a district that stops being valid before it starts", async () => {
    const w = await makeWorld();
    const message = await rejection(
      db.insert(districts).values({
        chamberId: w.chamberA,
        externalDistrictId: "2",
        validFrom: "2026-01-01",
        validTo: "2020-01-01",
      }),
    );
    expect(message).toMatch(/districts_dates_ordered/);
  });
});

describe("Vote — a bill must belong to the vote's own session", () => {
  it("rejects a vote whose bill is from a different session", async () => {
    const w = await makeWorld();
    const [otherSession] = await db
      .insert(legislativeSessions)
      .values({ jurisdictionId: w.jurisdictionId, externalSessionId: "s2", startDate: "2027-01-01" })
      .returning({ id: legislativeSessions.id });
    const [bill] = await db
      .insert(bills)
      .values({ sessionId: otherSession.id, externalBillId: "HB 1", sourceItem: w.sourceItem })
      .returning({ id: bills.id });

    const message = await rejection(
      db.insert(votes).values({
        chamberId: w.chamberA,
        sessionId: w.sessionId,
        externalVoteId: "v1",
        billId: bill.id,
        voteDate: "2026-02-01",
        result: "passed",
        sourceItem: w.sourceItem,
      }),
    );
    expect(message).toMatch(/votes_bill_in_session_fk/);
  });

  it("still allows a procedural vote with no bill", async () => {
    const w = await makeWorld();
    await expect(
      db.insert(votes).values({
        chamberId: w.chamberA,
        sessionId: w.sessionId,
        externalVoteId: "procedural",
        voteDate: "2026-02-01",
        result: "passed",
        sourceItem: w.sourceItem,
      }),
    ).resolves.toBeDefined();
  });
});

describe("Committee & Meeting", () => {
  it("rejects a committee whose chamber belongs to a different jurisdiction", async () => {
    const w = await makeWorld();
    const other = await makeWorld();
    const message = await rejection(
      db.insert(committees).values({
        jurisdictionId: w.jurisdictionId,
        chamberId: other.chamberA,
        externalCommitteeId: "C1",
        name: "Test",
        sourceItem: w.sourceItem,
      }),
    );
    expect(message).toMatch(/committees_chamber_in_jurisdiction_fk/);
  });

  it("rejects a meeting with both or neither of committee/chamber", async () => {
    const w = await makeWorld();
    const message = await rejection(
      db.insert(meetings).values({
        externalMeetingId: "m1",
        scheduledAt: new Date(),
        sourceItem: w.sourceItem,
      }),
    );
    expect(message).toMatch(/meetings_exactly_one_owner/);
  });

  it("rejects the same floor session inserted twice (NULL committee_id must not defeat the key)", async () => {
    const w = await makeWorld();
    const floor = {
      chamberId: w.chamberA,
      externalMeetingId: "floor-1",
      scheduledAt: new Date(),
      sourceItem: w.sourceItem,
    };
    await db.insert(meetings).values(floor);
    expect(await rejection(db.insert(meetings).values(floor))).toMatch(/duplicate key|unique/i);
  });
});

describe("NewsItem — dedup key and provenance", () => {
  it("rejects the same (content_hash, canonical_url) twice", async () => {
    const sourceItemId = await makeSourceItem();
    const item = {
      platform: "news" as const,
      canonicalUrl: `https://example.com/${randomUUID()}`,
      contentHash: randomUUID(),
      headlineOrText: "Dup",
    };
    await db.transaction(async (tx) => {
      const [row] = await tx.insert(newsItems).values(item).returning({ id: newsItems.id });
      await tx.insert(newsItemSources).values({ newsItemId: row.id, sourceItemId });
    });
    const message = await rejection(
      db.transaction(async (tx) => {
        const [row] = await tx.insert(newsItems).values(item).returning({ id: newsItems.id });
        await tx.insert(newsItemSources).values({ newsItemId: row.id, sourceItemId });
      }),
    );
    expect(message).toMatch(/news_items_content_hash_canonical_url_unique/);
  });

  it("rejects a transaction that commits a NewsItem with no NewsItemSource", async () => {
    const message = await rejection(
      db.transaction(async (tx) => {
        await tx.insert(newsItems).values({
          platform: "news",
          canonicalUrl: `https://example.com/${randomUUID()}`,
          contentHash: randomUUID(),
          headlineOrText: "No provenance",
        });
      }),
    );
    expect(message).toMatch(/has no NewsItemSource row/);
  });

  it("rejects deleting a NewsItem's only source while the item still exists", async () => {
    const newsItemId = await makeNewsItem();
    const message = await rejection(
      db.transaction(async (tx) => {
        await tx.delete(newsItemSources).where(sql`news_item_id = ${newsItemId}`);
      }),
    );
    expect(message).toMatch(/has no NewsItemSource row/);
  });

  it("allows deleting a NewsItem together with its sources", async () => {
    const newsItemId = await makeNewsItem();
    await db.transaction(async (tx) => {
      await tx.delete(newsItemSources).where(sql`news_item_id = ${newsItemId}`);
      await tx.delete(newsItems).where(sql`id = ${newsItemId}`);
    });
  });
});

describe("Suppression fields must agree", () => {
  it("rejects a suppressed NewsItem with no timestamp/reason", async () => {
    const sourceItemId = await makeSourceItem();
    const message = await rejection(
      db.transaction(async (tx) => {
        const [row] = await tx
          .insert(newsItems)
          .values({
            platform: "news",
            canonicalUrl: `https://example.com/${randomUUID()}`,
            contentHash: randomUUID(),
            headlineOrText: "x",
            isSuppressed: true,
          })
          .returning({ id: newsItems.id });
        await tx.insert(newsItemSources).values({ newsItemId: row.id, sourceItemId });
      }),
    );
    expect(message).toMatch(/news_items_suppression_consistent/);
  });

  it("accepts a fully specified suppression and rejects an orphan reason on an unsuppressed row", async () => {
    const newsItemId = await makeNewsItem();
    await expect(
      db.execute(
        sql`UPDATE news_items SET is_suppressed = true, suppressed_at = now(), suppression_reason = 'retracted' WHERE id = ${newsItemId}`,
      ),
    ).resolves.toBeDefined();
    const message = await rejection(
      db.execute(sql`UPDATE news_items SET is_suppressed = false WHERE id = ${newsItemId}`),
    );
    expect(message).toMatch(/news_items_suppression_consistent/);
  });

  it("applies to claims too", async () => {
    const newsItemId = await makeNewsItem();
    const sourceItemId = await makeSourceItem();
    const message = await rejection(
      db.transaction(async (tx) => {
        const [claim] = await tx
          .insert(claims)
          .values({ newsItemId, exactText: "t", claimantText: "c", isSuppressed: true })
          .returning({ id: claims.id });
        await tx.insert(claimSources).values({ claimId: claim.id, sourceItemId, relation: "primary" });
      }),
    );
    expect(message).toMatch(/claims_suppression_consistent/);
  });
});

describe("Exclusive-arc evidence/response rows can't be duplicated", () => {
  async function makePromise(): Promise<string> {
    const w = await makeWorld();
    const sourceItemId = await makeSourceItem();
    return db.transaction(async (tx) => {
      const [promise] = await tx
        .insert(promises)
        .values({ politicianId: w.politicianId, exactText: "I will do a thing" })
        .returning({ id: promises.id });
      await tx.insert(promiseSources).values({ promiseId: promise.id, sourceItemId, relation: "primary" });
      return promise.id;
    });
  }

  it("rejects the same news item attached to a promise twice, whatever the stance", async () => {
    const promiseId = await makePromise();
    const newsItemId = await makeNewsItem();
    await db.insert(promiseEvidence).values({ promiseId, newsItemId, supports: "context" });
    const message = await rejection(
      db.insert(promiseEvidence).values({ promiseId, newsItemId, supports: "fulfillment" }),
    );
    expect(message).toMatch(/promise_evidence_news_item_uq/);
  });

  it("rejects the same response news item on a claim twice", async () => {
    const newsItemId = await makeNewsItem();
    const sourceItemId = await makeSourceItem();
    const claimId = await db.transaction(async (tx) => {
      const [claim] = await tx
        .insert(claims)
        .values({ newsItemId, exactText: "t", claimantText: "c" })
        .returning({ id: claims.id });
      await tx.insert(claimSources).values({ claimId: claim.id, sourceItemId, relation: "primary" });
      return claim.id;
    });
    const responseNewsItemId = await makeNewsItem();
    await db.insert(claimResponses).values({ claimId, responseNewsItemId, stance: "denies" });
    const message = await rejection(
      db.insert(claimResponses).values({ claimId, responseNewsItemId, stance: "clarifies" }),
    );
    expect(message).toMatch(/claim_responses_news_item_uq/);
  });
});

describe("Promise fulfillment_status is evidence-framed", () => {
  it("rejects the verdict-framed values it used to allow", async () => {
    for (const verdict of ["fulfilled", "broken", "partially_fulfilled"]) {
      const message = await rejection(
        db.execute(
          sql`INSERT INTO promises (politician_id, exact_text, fulfillment_status) VALUES (gen_random_uuid(), 'x', ${verdict})`,
        ),
      );
      expect(message).toMatch(/invalid input value for enum fulfillment_status/);
    }
  });

  it("defaults to not_assessed", async () => {
    const w = await makeWorld();
    const sourceItemId = await makeSourceItem();
    const status = await db.transaction(async (tx) => {
      const [promise] = await tx
        .insert(promises)
        .values({ politicianId: w.politicianId, exactText: "x" })
        .returning({ id: promises.id, status: promises.fulfillmentStatus });
      await tx.insert(promiseSources).values({ promiseId: promise.id, sourceItemId, relation: "primary" });
      return promise.status;
    });
    expect(status).toBe("not_assessed");
  });
});

describe("IssueArea hierarchy", () => {
  it("rejects an area that is its own parent, and allows a real parent/child", async () => {
    const slug = `area-${randomUUID()}`;
    const [parent] = await db
      .insert(issueAreas)
      .values({ name: "Parent", slug })
      .returning({ id: issueAreas.id });
    await expect(
      db.insert(issueAreas).values({ name: "Child", slug: `${slug}-child`, parentIssueAreaId: parent.id }),
    ).resolves.toBeDefined();
    const message = await rejection(
      db.execute(sql`UPDATE issue_areas SET parent_issue_area_id = id WHERE id = ${parent.id}`),
    );
    expect(message).toMatch(/issue_areas_not_self_parent/);
  });
});

describe("ProcessorRun", () => {
  it("rejects a finished run with no finish time, and a finish time before the start", async () => {
    const run = { processorName: "test", processorVersion: "1", config: {}, inputRef: {} };
    expect(await rejection(db.insert(processorRuns).values({ ...run, status: "succeeded" }))).toMatch(
      /processor_runs_status_matches_finished_at/,
    );
    expect(
      await rejection(
        db.insert(processorRuns).values({
          ...run,
          status: "succeeded",
          startedAt: new Date("2026-01-02"),
          finishedAt: new Date("2026-01-01"),
        }),
      ),
    ).toMatch(/processor_runs_finished_after_started/);
  });
});

describe("updated_at trigger coverage", () => {
  beforeAll(async () => {
    await makeSourceItem();
  });

  it("every table with an updated_at column has the set_updated_at trigger", async () => {
    const rows = await db.execute<{ table_name: string }>(sql`
      SELECT c.table_name
      FROM information_schema.columns c
      WHERE c.table_schema = 'public' AND c.column_name = 'updated_at'
        AND NOT EXISTS (
          SELECT 1 FROM pg_trigger t
          WHERE t.tgrelid = ('public.' || quote_ident(c.table_name))::regclass
            AND t.tgname = 'set_updated_at'
        )
    `);
    expect([...rows].map((r) => r.table_name)).toEqual([]);
  });
});

