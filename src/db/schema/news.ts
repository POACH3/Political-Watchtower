// "News & social" — see SPEC.md "Aggregator output schema". First of
// Stage 2's tables, deliberately in a separate migration from Stage 1's
// government-records schema — see "Staging notes".

import { sql } from "drizzle-orm";
import { boolean, check, pgEnum, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { idColumn, timestampColumns } from "./_shared";
import { collectedItems } from "./collected-items";
import { politicians } from "./people";

export const platformEnum = pgEnum("platform", ["news", "x", "facebook", "instagram", "rss", "other"]);

export const newsItems = pgTable("news_items", {
  ...idColumn,
  platform: platformEnum("platform").notNull(),
  // The article/post's own URL — distinct from whatever
  // CollectedItem.sourceUrl the fetch came through (a GDELT-sourced
  // item's fetch URL is a GDELT record, not the article itself).
  canonicalUrl: text("canonical_url").notNull(),
  // The item's own publication time — distinct from any one
  // CollectedItem's retrievedTimestamp (when *we* fetched it).
  publishedAt: timestamp("published_at", { withTimezone: true }),
  // For exact-dedup, checked by the aggregator before writing a new row.
  contentHash: text("content_hash").notNull(),
  authorName: text("author_name"),
  authorHandle: text("author_handle"),
  headlineOrText: text("headline_or_text").notNull(),
  // A short quote, not a full-text mirror — see provenance-storage
  // decision in "Claim-preserving content model".
  excerpt: text("excerpt"),
  isSuppressed: boolean("is_suppressed").notNull().default(false),
  suppressedAt: timestamp("suppressed_at", { withTimezone: true }),
  suppressionReason: text("suppression_reason"),
  ...timestampColumns,
});
// No duplicate_of column — see SPEC.md: it was a third, contradictory
// dedup mechanism on top of this contentHash check and NewsItemRelation
// below; one mechanism, not two.

export const newsItemSources = pgTable(
  "news_item_sources",
  {
    ...idColumn,
    newsItemId: uuid("news_item_id")
      .notNull()
      .references(() => newsItems.id),
    sourceItemId: uuid("source_item_id")
      .notNull()
      .references(() => collectedItems.id),
    ...timestampColumns,
  },
  (table) => [unique().on(table.newsItemId, table.sourceItemId)],
);

export const newsItemRelationTypeEnum = pgEnum("news_item_relation_type", [
  "exact_duplicate",
  "possible_near_duplicate",
]);

export const newsItemRelations = pgTable(
  "news_item_relations",
  {
    ...idColumn,
    newsItemAId: uuid("news_item_a_id")
      .notNull()
      .references(() => newsItems.id),
    newsItemBId: uuid("news_item_b_id")
      .notNull()
      .references(() => newsItems.id),
    relationType: newsItemRelationTypeEnum("relation_type").notNull(),
    ...timestampColumns,
  },
  // Canonicalization (smaller ID first) enforced at the DB level, not
  // just app discipline. Corrected claim, previously stated here as the
  // reason to skip this: Postgres *does* have a portable CHECK for
  // "smaller of two UUIDs" — uuid has a default btree operator class, so
  // ordinary `<` comparison works in a CHECK constraint. Without this +
  // the UNIQUE below, a processor re-run (e.g. nightly near-duplicate
  // detection) duplicates the relation indefinitely, and the admin
  // review queue this feeds shows the same pair over and over.
  (table) => [
    check("news_item_relations_canonical_order", sql`${table.newsItemAId} < ${table.newsItemBId}`),
    unique().on(table.newsItemAId, table.newsItemBId, table.relationType),
  ],
);

export const mentionConfidenceEnum = pgEnum("mention_confidence", ["confirmed", "inferred"]);

export const newsItemPoliticians = pgTable(
  "news_item_politicians",
  {
    ...idColumn,
    newsItemId: uuid("news_item_id")
      .notNull()
      .references(() => newsItems.id),
    politicianId: uuid("politician_id")
      .notNull()
      .references(() => politicians.id),
    confidence: mentionConfidenceEnum("confidence").notNull(),
    // An admin's correction (confirming or rejecting a mention) survives
    // the next entity-resolution run — see "Review & audit".
    locked: boolean("locked").notNull().default(false),
    ...timestampColumns,
  },
  (table) => [unique().on(table.newsItemId, table.politicianId)],
);
