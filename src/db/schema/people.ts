// "People & positions" — see SPEC.md "Aggregator output schema".

import { boolean, date, pgEnum, pgTable, text, unique, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
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
  (table) => [unique().on(table.politicianId, table.aliasText, table.aliasType)],
);

export const terms = pgTable("terms", {
  ...idColumn,
  politicianId: uuid("politician_id")
    .notNull()
    .references(() => politicians.id),
  jurisdictionId: uuid("jurisdiction_id")
    .notNull()
    .references((): AnyPgColumn => jurisdictions.id),
  chamberId: uuid("chamber_id")
    .notNull()
    .references((): AnyPgColumn => chambers.id),
  districtId: uuid("district_id")
    .notNull()
    .references((): AnyPgColumn => districts.id),
  // The race that put this person in this seat, if tracked.
  candidacyId: uuid("candidacy_id").references((): AnyPgColumn => candidacies.id),
  party: text("party").notNull(),
  startDate: date("start_date").notNull(),
  // Nullable; null = currently serving. "Current party" is derived from
  // the most recent Term with a null endDate, not stored redundantly.
  endDate: date("end_date"),
  sourceItem: uuid("source_item")
    .notNull()
    .references(() => collectedItems.id),
  ...timestampColumns,
});
// No two Term rows for the same politicianId + chamberId should have
// overlapping [startDate, endDate) ranges — added as a real Postgres
// EXCLUDE constraint in a hand-written migration (Drizzle has no native
// syntax for exclusion constraints), not just app-level discipline.
// See migrations/ and "Term" in SPEC.md.
