// "Promises & priorities" — see SPEC.md "Aggregator output schema".

import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
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
  (table) => [unique().on(table.politicianId, table.issueAreaId)],
);

export const fulfillmentStatusEnum = pgEnum("fulfillment_status", [
  "not_yet_due",
  "in_progress",
  "fulfilled",
  "broken",
  "partially_fulfilled",
  "stalled",
]);

export const promises = pgTable("promises", {
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
  fulfillmentStatus: fulfillmentStatusEnum("fulfillment_status").notNull().default("not_yet_due"),
  fulfillmentLocked: boolean("fulfillment_locked").notNull().default(false),
  ...timestampColumns,
});

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
    unique().on(table.promiseId, table.billId, table.voteId, table.newsItemId, table.claimId),
  ],
);
