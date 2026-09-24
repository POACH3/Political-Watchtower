// "Review & audit" — see SPEC.md "Aggregator output schema". Both tables
// here are deliberately not FK'd to their targets: ReviewAction spans
// six different target tables (claim/promise/news_item_politician/
// politician_alias/collected_item/affiliation) and SuppressionRule matches by
// pattern, not by row — polymorphism is the right call here, unlike
// PromiseEvidence/ClaimResponse's two-to-four-type cases where exclusive-
// arc FKs were worth the extra columns.

import { index, jsonb, pgEnum, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAtColumn, idColumn } from "./_shared";

export const reviewTargetTypeEnum = pgEnum("review_target_type", [
  "claim",
  "promise",
  "news_item_politician",
  "politician_alias",
  "collected_item",
  // Affiliation's table lands in Stage 10; the value is here now because
  // SPEC.md lists it in ReviewAction/CommunityFlag's shared target set.
  "affiliation",
]);

// Written whenever an admin action changes a field that also has a
// locked/verificationLocked-style flag; the write and the lock happen
// together, not as two separate steps that could drift apart.
export const reviewActions = pgTable(
  "review_actions",
  {
    ...idColumn,
    targetType: reviewTargetTypeEnum("target_type").notNull(),
    targetId: uuid("target_id").notNull(),
    fieldChanged: text("field_changed").notNull(),
    // field_changed varies by target_type (a verification_status enum one
    // row, a fulfillment_status enum another, ...), so the value being
    // corrected is a different type each time — jsonb captures whatever it
    // actually was without a sparse table of nullable typed columns.
    previousValue: jsonb("previous_value"),
    newValue: jsonb("new_value"),
    reason: text("reason"),
    actor: text("actor").notNull(),
    ...createdAtColumn,
  },
  // (target_type, target_id) is the only access path this table has —
  // "show the review history for this claim" — and it was entirely
  // unindexed.
  (table) => [index("review_actions_target_idx").on(table.targetType, table.targetId)],
);

export const suppressionRuleTypeEnum = pgEnum("suppression_rule_type", [
  "url_pattern",
  "content_hash",
  "claim_text_pattern",
]);

// What stops a suppressed claim from being silently re-created on the
// next crawl — checked by the aggregator (url_pattern/content_hash,
// before writing a NewsItem) and the claim-extraction processor
// (claim_text_pattern, before writing a Claim).
export const suppressionRules = pgTable("suppression_rules", {
  ...idColumn,
  ruleType: suppressionRuleTypeEnum("rule_type").notNull(),
  pattern: text("pattern").notNull(),
  reason: text("reason").notNull(),
  createdBy: text("created_by").notNull(),
  ...createdAtColumn,
});
