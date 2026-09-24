// "Claim-preserving content model" — see SPEC.md. The core of Stage 2:
// the claim-preserving pipeline (extract → attribute → verify →
// summarize) needs somewhere to write to, and this is it.

import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { idColumn, suppressionConsistentCheck, timestampColumns } from "./_shared";
import { collectedItems } from "./collected-items";
import { newsItems } from "./news";
import { politicians } from "./people";
import { processorRuns } from "./processor-runs";

export const verificationStatusEnum = pgEnum("verification_status", [
  "UNVERIFIED_CLAIM",
  "SUPPORTED_BY_PRIMARY_SOURCE",
  "CORROBORATED",
  "CONTRADICTED",
  "DISPUTED_BY_SOURCE",
  "OPINION",
  "SATIRE",
  "UNKNOWN",
]);

export const verificationSetByEnum = pgEnum("verification_set_by", ["processor", "admin"]);

export const claims = pgTable(
  "claims",
  {
    ...idColumn,
    newsItemId: uuid("news_item_id")
      .notNull()
      .references(() => newsItems.id),
    exactText: text("exact_text").notNull(),
    normalizedClaim: text("normalized_claim"),
    // Who said it, as written/reported.
    claimantText: text("claimant_text").notNull(),
    // When the claimant is a politician already tracked — lets the site
    // show "this allegation came from their opponent."
    claimantPoliticianId: uuid("claimant_politician_id").references(() => politicians.id),
    publicationTimestamp: timestamp("publication_timestamp", { withTimezone: true }),
    retrievedTimestamp: timestamp("retrieved_timestamp", { withTimezone: true }).notNull().defaultNow(),
    verificationStatus: verificationStatusEnum("verification_status").notNull().default("UNVERIFIED_CLAIM"),
    verificationSetBy: verificationSetByEnum("verification_set_by").notNull().default("processor"),
    verificationSetAt: timestamp("verification_set_at", { withTimezone: true }).notNull().defaultNow(),
    // A processor re-run skips a locked row instead of silently
    // recomputing over a human's override.
    verificationLocked: boolean("verification_locked").notNull().default(false),
    isSuppressed: boolean("is_suppressed").notNull().default(false),
    suppressedAt: timestamp("suppressed_at", { withTimezone: true }),
    suppressionReason: text("suppression_reason"),
    // Which extraction/summarization pass produced this row — processor
    // version, model and config are derivable through the join, not
    // duplicated per row (see SPEC.md "ProcessorRun").
    processorRunId: uuid("processor_run_id").references(() => processorRuns.id),
    // The claim-preserving summary, not a bare assertion.
    generatedSummary: text("generated_summary"),
    ...timestampColumns,
  },
  (table) => [
    suppressionConsistentCheck("claims_suppression_consistent", table),
    index("claims_news_item_idx").on(table.newsItemId),
    index("claims_claimant_politician_idx").on(table.claimantPoliticianId),
    index("claims_processor_run_idx").on(table.processorRunId),
  ],
);

export const targetConfidenceEnum = pgEnum("target_confidence", ["confirmed", "inferred"]);

export const claimTargets = pgTable(
  "claim_targets",
  {
    ...idColumn,
    claimId: uuid("claim_id")
      .notNull()
      .references(() => claims.id),
    politicianId: uuid("politician_id")
      .notNull()
      .references(() => politicians.id),
    confidence: targetConfidenceEnum("confidence").notNull(),
    ...timestampColumns,
  },
  // Without this, a claim-extraction re-run (e.g. on a new model_version)
  // duplicates the row — repeating an unproven allegation against the
  // same named person multiple times on their public profile.
  (table) => [
    unique().on(table.claimId, table.politicianId),
    // "Claims about this politician" — the profile page's access path.
    index("claim_targets_politician_idx").on(table.politicianId),
  ],
);

export const claimResponseStanceEnum = pgEnum("claim_response_stance", [
  "denies",
  "confirms",
  "clarifies",
]);

// Exclusive-arc FKs, same fix as PromiseEvidence — a response is either a
// NewsItem or another Claim (e.g. a follow-up statement that itself gets
// claim-extracted); real FK integrity on each, not a
// response_type/response_id polymorphic pair with none.
export const claimResponses = pgTable(
  "claim_responses",
  {
    ...idColumn,
    claimId: uuid("claim_id")
      .notNull()
      .references(() => claims.id),
    responseNewsItemId: uuid("response_news_item_id").references(() => newsItems.id),
    responseClaimId: uuid("response_claim_id").references(() => claims.id),
    stance: claimResponseStanceEnum("stance").notNull(),
    ...timestampColumns,
  },
  (table) => [
    check(
      "claim_responses_exactly_one_target",
      sql`num_nonnulls(${table.responseNewsItemId}, ${table.responseClaimId}) = 1`,
    ),
    // One partial unique index per arc — a plain UNIQUE over two
    // nullable columns treats NULLs as distinct and would never fire.
    uniqueIndex("claim_responses_news_item_uq")
      .on(table.claimId, table.responseNewsItemId)
      .where(sql`${table.responseNewsItemId} IS NOT NULL`),
    uniqueIndex("claim_responses_claim_uq")
      .on(table.claimId, table.responseClaimId)
      .where(sql`${table.responseClaimId} IS NOT NULL`),
    index("claim_responses_response_news_item_idx")
      .on(table.responseNewsItemId)
      .where(sql`${table.responseNewsItemId} IS NOT NULL`),
    index("claim_responses_response_claim_idx")
      .on(table.responseClaimId)
      .where(sql`${table.responseClaimId} IS NOT NULL`),
  ],
);

export const claimSourceRelationEnum = pgEnum("claim_source_relation", [
  "primary",
  "supporting",
  "contradicting",
]);

export const claimSources = pgTable(
  "claim_sources",
  {
    ...idColumn,
    claimId: uuid("claim_id")
      .notNull()
      .references(() => claims.id),
    sourceItemId: uuid("source_item_id")
      .notNull()
      .references(() => collectedItems.id),
    relation: claimSourceRelationEnum("relation").notNull(),
    ...timestampColumns,
  },
  (table) => [
    // Exactly one 'primary' row per claim.
    uniqueIndex("claim_sources_one_primary_idx")
      .on(table.claimId)
      .where(sql`${table.relation} = 'primary'`),
    // The same source can't be cited twice for the same claim — a
    // processor re-run would otherwise duplicate the row.
    unique().on(table.claimId, table.sourceItemId),
    // Reverse lookup: "what derives from this collected item."
    index("claim_sources_source_item_idx").on(table.sourceItemId),
  ],
);

export const claimRelationTypeEnum = pgEnum("claim_relation_type", ["possible_restatement"]);

export const claimRelations = pgTable(
  "claim_relations",
  {
    ...idColumn,
    claimAId: uuid("claim_a_id")
      .notNull()
      .references(() => claims.id),
    claimBId: uuid("claim_b_id")
      .notNull()
      .references(() => claims.id),
    relationType: claimRelationTypeEnum("relation_type").notNull(),
    ...timestampColumns,
  },
  (table) => [
    // Canonicalization enforced at the DB level, not just app
    // discipline — a second independent review corrected an earlier
    // (wrong) claim in this file's comments that Postgres has no
    // portable CHECK for "smaller of two UUIDs"; it does, since uuid has
    // a default btree operator class. Without this + the UNIQUE below, a
    // processor re-run duplicates the relation indefinitely — the
    // review queue this feeds would show the same pair over and over.
    check("claim_relations_canonical_order", sql`${table.claimAId} < ${table.claimBId}`),
    unique().on(table.claimAId, table.claimBId, table.relationType),
  ],
);
