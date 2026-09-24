// "Promises & priorities" — see SPEC.md "Aggregator output schema".

import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { idColumn, timestampColumns } from "./_shared";
import { claims } from "./claims";
import { collectedItems } from "./collected-items";
import { bills, issueAreas } from "./legislation";
import { newsItems } from "./news";
import { politicians } from "./people";
import { processorRuns } from "./processor-runs";
import { votes } from "./votes";

// A politician's self-reported/campaign priorities, linked to the same
// IssueArea taxonomy as bill tagging — deliberately, so Stage 13 can
// plot stated priorities against actual voting-derived issue alignment
// on the same axes, not just list them.
export const politicianPriorityIssues = pgTable(
  "politician_priority_issues",
  {
    ...idColumn,
    politicianId: uuid("politician_id")
      .notNull()
      .references(() => politicians.id),
    issueAreaId: uuid("issue_area_id")
      .notNull()
      .references(() => issueAreas.id),
    sourceItem: uuid("source_item")
      .notNull()
      .references(() => collectedItems.id),
    // For showing "top 3" style if the source ranks them.
    displayOrder: integer("display_order"),
    ...timestampColumns,
  },
  // A politician shouldn't have the same issue area listed twice as a
  // priority — same reasoning as BillIssueArea's uniqueness constraint.
  (table) => [
    unique().on(table.politicianId, table.issueAreaId),
    index("politician_priority_issues_issue_area_idx").on(table.issueAreaId),
  ],
);

// Deliberately evidence-framed, not verdict-framed — "evidence_of_completion,"
// not "fulfilled"; the site reports what the evidence shows rather than
// adjudicating whether a promise was kept. See SPEC.md "Promise".
export const fulfillmentStatusEnum = pgEnum("fulfillment_status", [
  "not_assessed",
  "not_yet_due",
  "in_progress",
  "stalled",
  "evidence_of_completion",
  "evidence_of_partial_completion",
  "evidence_against_completion",
  "disputed",
]);

export const promises = pgTable(
  "promises",
  {
    ...idColumn,
    politicianId: uuid("politician_id")
      .notNull()
      .references(() => politicians.id),
    // Required — this is the promise; a Promise row without it has no
    // content, same reasoning as Politician.fullName or Claim.exactText.
    exactText: text("exact_text").notNull(),
    issueAreaId: uuid("issue_area_id").references(() => issueAreas.id),
    // Nullable — descriptive, not identifying (same principle applied to
    // Bill.introducedDate).
    dateMade: date("date_made"),
    // If the promise itself named a deadline (e.g. "by end of my first term").
    targetDate: date("target_date"),
    // What "delivered" would concretely look like for this promise,
    // distinct from exactText (the promise as stated). Filled in by
    // whichever layer first assesses it.
    measurableCriterion: text("measurable_criterion"),
    fulfillmentStatus: fulfillmentStatusEnum("fulfillment_status").notNull().default("not_assessed"),
    // Why fulfillmentStatus is what it is — makes a status change
    // explainable on the page itself, not just inferable from the linked
    // PromiseEvidence rows.
    assessmentReasoning: text("assessment_reasoning"),
    fulfillmentLocked: boolean("fulfillment_locked").notNull().default(false),
    // Which processor pass last assessed this row; version/model are
    // derivable through the join.
    processorRunId: uuid("processor_run_id").references(() => processorRuns.id),
    ...timestampColumns,
  },
  (table) => [
    index("promises_politician_idx").on(table.politicianId),
    index("promises_issue_area_idx").on(table.issueAreaId),
    index("promises_processor_run_idx").on(table.processorRunId),
  ],
);

export const promiseSourceRelationEnum = pgEnum("promise_source_relation", ["primary", "supporting"]);

export const promiseSources = pgTable(
  "promise_sources",
  {
    ...idColumn,
    promiseId: uuid("promise_id")
      .notNull()
      .references(() => promises.id),
    sourceItemId: uuid("source_item_id")
      .notNull()
      .references(() => collectedItems.id),
    relation: promiseSourceRelationEnum("relation").notNull(),
    ...timestampColumns,
  },
  (table) => [
    // This table had no "exactly one primary" enforcement at all — the
    // same partial-unique-index fix ClaimSource already had, missing
    // here even though SPEC.md describes the same relation shape for
    // both.
    uniqueIndex("promise_sources_one_primary_idx")
      .on(table.promiseId)
      .where(sql`${table.relation} = 'primary'`),
    unique().on(table.promiseId, table.sourceItemId),
    // Reverse lookup: "what derives from this collected item."
    index("promise_sources_source_item_idx").on(table.sourceItemId),
  ],
);

export const promiseRelationTypeEnum = pgEnum("promise_relation_type", ["possible_restatement"]);

export const promiseRelations = pgTable(
  "promise_relations",
  {
    ...idColumn,
    promiseAId: uuid("promise_a_id")
      .notNull()
      .references(() => promises.id),
    promiseBId: uuid("promise_b_id")
      .notNull()
      .references(() => promises.id),
    relationType: promiseRelationTypeEnum("relation_type").notNull(),
    ...timestampColumns,
  },
  // Canonicalization enforced at the DB level — see claims.ts's
  // claimRelations for the same fix and why the "no portable CHECK for
  // this" reasoning that used to justify skipping it was wrong.
  (table) => [
    check("promise_relations_canonical_order", sql`${table.promiseAId} < ${table.promiseBId}`),
    unique().on(table.promiseAId, table.promiseBId, table.relationType),
  ],
);

export const promiseEvidenceSupportsEnum = pgEnum("promise_evidence_supports", [
  "fulfillment",
  "non_fulfillment",
  "context",
]);

// Exclusive-arc FKs — see SPEC.md: originally a polymorphic
// evidence_type/evidence_id pair, corrected to four nullable FKs with a
// check constraint for real referential integrity at no cost.
export const promiseEvidence = pgTable(
  "promise_evidence",
  {
    ...idColumn,
    promiseId: uuid("promise_id")
      .notNull()
      .references(() => promises.id),
    billId: uuid("bill_id").references(() => bills.id),
    voteId: uuid("vote_id").references(() => votes.id),
    newsItemId: uuid("news_item_id").references(() => newsItems.id),
    claimId: uuid("claim_id").references(() => claims.id),
    supports: promiseEvidenceSupportsEnum("supports").notNull(),
    ...timestampColumns,
  },
  (table) => [
    check(
      "promise_evidence_exactly_one_target",
      sql`num_nonnulls(${table.billId}, ${table.voteId}, ${table.newsItemId}, ${table.claimId}) = 1`,
    ),
    // One partial unique index per arc, not one UNIQUE over all four
    // nullable FKs: a plain UNIQUE treats NULLs as distinct, so the
    // combined key could never fire and the same evidence could be
    // attached to a promise any number of times. `supports` is
    // deliberately not part of any key — one evidence item has one stance
    // per promise, updated in place, so the same bill can't be both
    // 'fulfillment' and 'non_fulfillment'. Each index doubles as the
    // (promise, target) lookup.
    uniqueIndex("promise_evidence_bill_uq")
      .on(table.promiseId, table.billId)
      .where(sql`${table.billId} IS NOT NULL`),
    uniqueIndex("promise_evidence_vote_uq")
      .on(table.promiseId, table.voteId)
      .where(sql`${table.voteId} IS NOT NULL`),
    uniqueIndex("promise_evidence_news_item_uq")
      .on(table.promiseId, table.newsItemId)
      .where(sql`${table.newsItemId} IS NOT NULL`),
    uniqueIndex("promise_evidence_claim_uq")
      .on(table.promiseId, table.claimId)
      .where(sql`${table.claimId} IS NOT NULL`),
    // Reverse lookups: "which promises cite this bill/vote/...".
    index("promise_evidence_bill_idx").on(table.billId).where(sql`${table.billId} IS NOT NULL`),
    index("promise_evidence_vote_idx").on(table.voteId).where(sql`${table.voteId} IS NOT NULL`),
    index("promise_evidence_news_item_idx")
      .on(table.newsItemId)
      .where(sql`${table.newsItemId} IS NOT NULL`),
    index("promise_evidence_claim_idx").on(table.claimId).where(sql`${table.claimId} IS NOT NULL`),
  ],
);
