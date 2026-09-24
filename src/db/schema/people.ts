// "People & positions" — see SPEC.md "Aggregator output schema".

import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  pgEnum,
  pgTable,
  text,
  unique,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { idColumn, timestampColumns } from "./_shared";
import { collectedItems } from "./collected-items";
import { candidacies, chambers, districts, jurisdictions } from "./jurisdictions";

export const politicians = pgTable("politicians", {
  ...idColumn,
  // Required — the one content field that must be set beyond provenance;
  // everything else here is optional. See "People & positions" for the
  // placeholder-name handling when a Vote/Term/etc. references a
  // politician_id the aggregator hasn't synced a name for yet.
  fullName: text("full_name").notNull(),
  displayName: text("display_name"),
  photoUrl: text("photo_url"),
  bioText: text("bio_text"),
  birthDate: date("birth_date"),
  sourceItem: uuid("source_item")
    .notNull()
    .references(() => collectedItems.id),
  ...timestampColumns,
});

export const politicianExternalIds = pgTable(
  "politician_external_ids",
  {
    ...idColumn,
    politicianId: uuid("politician_id")
      .notNull()
      .references(() => politicians.id),
    jurisdictionId: uuid("jurisdiction_id")
      .notNull()
      .references((): AnyPgColumn => jurisdictions.id),
    externalId: text("external_id").notNull(),
    ...timestampColumns,
  },
  (table) => [unique().on(table.jurisdictionId, table.externalId)],
);

export const aliasTypeEnum = pgEnum("alias_type", [
  "legal_name",
  "nickname",
  "social_handle",
  "former_name",
  "ballot_name",
  "other",
]);

export const aliasConfidenceEnum = pgEnum("alias_confidence", ["confirmed", "inferred"]);

export const politicianAliases = pgTable(
  "politician_aliases",
  {
    ...idColumn,
    politicianId: uuid("politician_id")
      .notNull()
      .references(() => politicians.id),
    aliasText: text("alias_text").notNull(),
    aliasType: aliasTypeEnum("alias_type").notNull(),
    platform: text("platform"),
    confidence: aliasConfidenceEnum("confidence").notNull(),
    // Stops entity-resolution from overwriting an alias a human already
    // reviewed — confidence alone was a proxy for this, not an owner
    // distinction. See "Review & audit".
    locked: boolean("locked").notNull().default(false),
    ...timestampColumns,
  },
  (table) => [
    unique().on(table.politicianId, table.aliasText, table.aliasType),
    // Stage 9 entity resolution's first-pass lookup is case-insensitive.
    index("politician_aliases_alias_text_lower_idx").on(sql`lower(${table.aliasText})`),
  ],
);

export const terms = pgTable(
  "terms",
  {
    ...idColumn,
    politicianId: uuid("politician_id")
      .notNull()
      .references(() => politicians.id),
    // No jurisdictionId here — chamberId already implies it (chambers is
    // itself scoped to one jurisdiction), and districtId implies it a
    // second time over. A redundant copy on this row was a real risk,
    // not just untidy: nothing checked it agreed with chamberId's own
    // jurisdiction, so a bad write here could silently point a term at
    // the wrong jurisdiction's roster.
    chamberId: uuid("chamber_id")
      .notNull()
      .references((): AnyPgColumn => chambers.id),
    // No column-level .references() — the composite FK below is this
    // column's FK, and additionally guarantees the district belongs to
    // chamberId (previously a term could point at a district in a
    // different chamber, and nothing noticed).
    districtId: uuid("district_id").notNull(),
    // The race that put this person in this seat, if tracked.
    // No column-level .references() — see the composite FK below.
    candidacyId: uuid("candidacy_id"),
    // Nullable — per the "only provenance + the one identifying field are
    // required" principle: a term is still real and worth recording even
    // before we know (or for a nonpartisan legislature, ever know) the
    // party. Shown when known, never required to create the row.
    party: text("party"),
    startDate: date("start_date").notNull(),
    // Nullable; null = currently serving. "Current party" is derived from
    // the most recent Term with a null endDate, not stored redundantly.
    endDate: date("end_date"),
    sourceItem: uuid("source_item")
      .notNull()
      .references(() => collectedItems.id),
    ...timestampColumns,
  },
  (table) => [
    unique().on(table.politicianId, table.chamberId, table.startDate),
    foreignKey({
      name: "terms_district_in_chamber_fk",
      columns: [table.districtId, table.chamberId],
      foreignColumns: [districts.id, districts.chamberId],
    }),
    // A term's candidacy must be the same politician's. MATCH SIMPLE
    // skips it when candidacyId is NULL (no race tracked).
    foreignKey({
      name: "terms_candidacy_is_own_fk",
      columns: [table.candidacyId, table.politicianId],
      foreignColumns: [candidacies.id, candidacies.politicianId],
    }),
    index("terms_chamber_idx").on(table.chamberId),
    index("terms_district_idx").on(table.districtId),
    // The current-roster query: who holds a seat right now.
    index("terms_current_idx")
      .on(table.chamberId, table.districtId)
      .where(sql`${table.endDate} IS NULL`),
    // Strictly after, not >=: the exclusion constraint below treats a
    // term as the half-open range [start, end), and an empty range would
    // never conflict with anything.
    check("terms_dates_ordered", sql`${table.endDate} IS NULL OR ${table.endDate} > ${table.startDate}`),
  ],
);
// No two Term rows for the same politicianId + chamberId should have
// overlapping [startDate, endDate) ranges — added as a real Postgres
// EXCLUDE constraint in a hand-written migration (Drizzle has no native
// syntax for exclusion constraints), not just app-level discipline.
// See migrations/ and "Term" in SPEC.md.
