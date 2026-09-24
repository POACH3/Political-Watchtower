import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { db } from "@/db";
import {
  claimRelations,
  claimSources,
  claims,
  newsItemSources,
  newsItems,
  promiseSources,
  promises,
} from "@/db/schema";
import { upsertJurisdiction } from "@/lib/services/jurisdictions";
import { upsertPoliticianByExternalId } from "@/lib/services/politicians";
import { makeSourceItem, pgErrorMessage } from "@/lib/test-utils";

// A NewsItem can't exist without a NewsItemSource (deferred trigger), so
// the helper writes both in one transaction.
async function makeNewsItem(): Promise<string> {
  const sourceItemId = await makeSourceItem();
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(newsItems)
      .values({
        platform: "news",
        canonicalUrl: "https://example.com/article",
        contentHash: randomUUID(),
        headlineOrText: "Test article",
      })
      .returning({ id: newsItems.id });
    await tx.insert(newsItemSources).values({ newsItemId: row.id, sourceItemId });
    return row.id;
  });
}

async function makeClaim(): Promise<string> {
  const newsItemId = await makeNewsItem();
  const sourceItemId = await makeSourceItem();
  return db.transaction(async (tx) => {
    const [claim] = await tx
      .insert(claims)
      .values({ newsItemId, exactText: "Test claim", claimantText: "Someone" })
      .returning({ id: claims.id });
    await tx.insert(claimSources).values({ claimId: claim.id, sourceItemId, relation: "primary" });
    return claim.id;
  });
}

async function makePolitician(): Promise<string> {
  const sourceItem = await makeSourceItem();
  const jurisdictionId = await upsertJurisdiction({
    slug: `test-stage2-${randomUUID()}`,
    name: "Test Jurisdiction",
    level: "state",
  });
  return upsertPoliticianByExternalId({
    jurisdictionId,
    externalId: randomUUID(),
    sourceItem,
    fullName: "Test Politician",
  });
}

// "Validation & acceptance criteria": "Attempting to insert a
// Claim/Promise with zero source rows fails at the DB layer, not just
// gets caught later by app logic." Enforced via a DEFERRED constraint
// trigger (migrations/0001_narrative_oversight_schema.sql) — these tests exercise
// that directly through a transaction, the same way the service layer
// will create a Claim/Promise and its primary source together.
describe("Claim requires at least one ClaimSource (deferred trigger)", () => {
  it("rejects a transaction that commits a Claim with no source", async () => {
    const newsItemId = await makeNewsItem();

    const error = await db
      .transaction(async (tx) => {
        await tx.insert(claims).values({
          newsItemId,
          exactText: "Test claim",
          claimantText: "Someone",
        });
      })
      .catch((e) => e);

    expect(pgErrorMessage(error)).toMatch(/has no primary ClaimSource row/);
  });

  // Regression test for a bug an independent review caught: the trigger
  // originally checked "has a ClaimSource of any relation," which let a
  // Claim commit with only a 'contradicting'/'supporting' source and no
  // 'primary' one — exactly the "where did this claim come from" gap the
  // provenance design exists to close.
  it("rejects a transaction that commits a Claim with only a non-primary source", async () => {
    const newsItemId = await makeNewsItem();
    const sourceItemId = await makeSourceItem();

    const error = await db
      .transaction(async (tx) => {
        const [claim] = await tx
          .insert(claims)
          .values({ newsItemId, exactText: "Test claim", claimantText: "Someone" })
          .returning({ id: claims.id });

        await tx.insert(claimSources).values({
          claimId: claim.id,
          sourceItemId,
          relation: "contradicting",
        });
      })
      .catch((e) => e);

    expect(pgErrorMessage(error)).toMatch(/has no primary ClaimSource row/);
  });

  it("allows a transaction that adds a primary source before commit", async () => {
    const newsItemId = await makeNewsItem();
    const sourceItemId = await makeSourceItem();

    await expect(
      db.transaction(async (tx) => {
        const [claim] = await tx
          .insert(claims)
          .values({ newsItemId, exactText: "Test claim", claimantText: "Someone" })
          .returning({ id: claims.id });

        await tx.insert(claimSources).values({
          claimId: claim.id,
          sourceItemId,
          relation: "primary",
        });
      }),
    ).resolves.not.toThrow();
  });
});

describe("ClaimSource — at most one 'primary' per claim (partial unique index)", () => {
  it("rejects a second primary source for the same claim", async () => {
    const newsItemId = await makeNewsItem();
    const sourceItemA = await makeSourceItem();
    const sourceItemB = await makeSourceItem();

    const claimId = await db.transaction(async (tx) => {
      const [claim] = await tx
        .insert(claims)
        .values({ newsItemId, exactText: "Test claim", claimantText: "Someone" })
        .returning({ id: claims.id });
      await tx.insert(claimSources).values({ claimId: claim.id, sourceItemId: sourceItemA, relation: "primary" });
      return claim.id;
    });

    const error = await db
      .insert(claimSources)
      .values({ claimId, sourceItemId: sourceItemB, relation: "primary" })
      .catch((e) => e);

    expect(pgErrorMessage(error)).toMatch(/duplicate key value violates unique constraint "claim_sources_one_primary_idx"/);
  });

  it("allows a second 'supporting' source for the same claim", async () => {
    const newsItemId = await makeNewsItem();
    const sourceItemA = await makeSourceItem();
    const sourceItemB = await makeSourceItem();

    const claimId = await db.transaction(async (tx) => {
      const [claim] = await tx
        .insert(claims)
        .values({ newsItemId, exactText: "Test claim", claimantText: "Someone" })
        .returning({ id: claims.id });
      await tx.insert(claimSources).values({ claimId: claim.id, sourceItemId: sourceItemA, relation: "primary" });
      return claim.id;
    });

    await expect(
      db.insert(claimSources).values({ claimId, sourceItemId: sourceItemB, relation: "supporting" }),
    ).resolves.not.toThrow();
  });
});

// A second independent review corrected an earlier (wrong) claim in this
// schema's comments that Postgres has no portable CHECK for "smaller of
// two UUIDs" — it does, since uuid has a default btree operator class.
// Without the canonical-order CHECK + UNIQUE, a processor re-run (e.g.
// nightly near-duplicate detection) would duplicate the relation
// indefinitely.
describe("ClaimRelation — canonical order CHECK constraint", () => {
  it("rejects a row where claim_a_id is not less than claim_b_id", async () => {
    const claimA = await makeClaim();
    const claimB = await makeClaim();
    const [bigger, smaller] = claimA < claimB ? [claimB, claimA] : [claimA, claimB];

    const error = await db
      .insert(claimRelations)
      .values({ claimAId: bigger, claimBId: smaller, relationType: "possible_restatement" })
      .catch((e) => e);

    expect(pgErrorMessage(error)).toMatch(
      /violates check constraint "claim_relations_canonical_order"/,
    );
  });

  it("allows a row where claim_a_id is less than claim_b_id", async () => {
    const claimA = await makeClaim();
    const claimB = await makeClaim();
    const [smaller, bigger] = claimA < claimB ? [claimA, claimB] : [claimB, claimA];

    await expect(
      db.insert(claimRelations).values({ claimAId: smaller, claimBId: bigger, relationType: "possible_restatement" }),
    ).resolves.not.toThrow();
  });
});

describe("Promise requires at least one PromiseSource (deferred trigger)", () => {
  it("rejects a transaction that commits a Promise with no source", async () => {
    const politicianId = await makePolitician();

    const error = await db
      .transaction(async (tx) => {
        await tx.insert(promises).values({
          politicianId,
          exactText: "I will do the thing",
          dateMade: "2026-01-01",
        });
      })
      .catch((e) => e);

    expect(pgErrorMessage(error)).toMatch(/has no primary PromiseSource row/);
  });

  // Regression test — same bug as the Claim case above, for PromiseSource.
  it("rejects a transaction that commits a Promise with only a non-primary source", async () => {
    const politicianId = await makePolitician();
    const sourceItemId = await makeSourceItem();

    const error = await db
      .transaction(async (tx) => {
        const [promise] = await tx
          .insert(promises)
          .values({ politicianId, exactText: "I will do the thing", dateMade: "2026-01-01" })
          .returning({ id: promises.id });

        await tx.insert(promiseSources).values({
          promiseId: promise.id,
          sourceItemId,
          relation: "supporting",
        });
      })
      .catch((e) => e);

    expect(pgErrorMessage(error)).toMatch(/has no primary PromiseSource row/);
  });

  it("allows a transaction that adds a source before commit", async () => {
    const politicianId = await makePolitician();
    const sourceItemId = await makeSourceItem();

    await expect(
      db.transaction(async (tx) => {
        const [promise] = await tx
          .insert(promises)
          .values({ politicianId, exactText: "I will do the thing", dateMade: "2026-01-01" })
          .returning({ id: promises.id });

        await tx.insert(promiseSources).values({
          promiseId: promise.id,
          sourceItemId,
          relation: "primary",
        });
      }),
    ).resolves.not.toThrow();
  });
});
