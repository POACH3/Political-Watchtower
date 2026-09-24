// "Jurisdictions & elections" — see SPEC.md "Aggregator output schema".
// Added after an independent review found jurisdiction_id/chamber were
// free-form strings with no backing table on five other tables — see
// that section for the full rationale.

import { sql } from "drizzle-orm";
import {
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
import { politicians } from "./people";

// 'other' on this and electionType/sponsorRole/platform below: a second
// independent schema review flagged these as fixed enums that will need
// a migration the moment real-world data doesn't fit the initial list —
// a UK/Canadian/Australian fork has no clean mapping for a provincial/
// devolved jurisdiction otherwise, which would fail the fork-ability
// acceptance test outright rather than just degrading gracefully.
export const jurisdictionLevelEnum = pgEnum("jurisdiction_level", [
  "federal",
  "state",
  "local",
  "other",
]);

export const jurisdictions = pgTable("jurisdictions", {
  ...idColumn,
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  level: jurisdictionLevelEnum("level").notNull(),
  parentJurisdictionId: uuid("parent_jurisdiction_id").references(
    (): AnyPgColumn => jurisdictions.id,
  ),
  ...timestampColumns,
});

export const chambers = pgTable(
  "chambers",
  {
    ...idColumn,
    jurisdictionId: uuid("jurisdiction_id")
      .notNull()
      .references(() => jurisdictions.id),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    ...timestampColumns,
  },
  (table) => [
    // SPEC.md states this explicitly ("slug — unique within jurisdiction").
    unique().on(table.jurisdictionId, table.slug),
    // Redundant as a key (id is already unique) but required as the
    // target of composite FKs from elections/committees, which is how
    // "this chamber belongs to this jurisdiction" gets enforced by the
    // database instead of by convention.
    unique().on(table.id, table.jurisdictionId),
  ],
);

export const legislativeSessions = pgTable(
  "legislative_sessions",
  {
    ...idColumn,
    jurisdictionId: uuid("jurisdiction_id")
      .notNull()
      .references(() => jurisdictions.id),
    externalSessionId: text("external_session_id").notNull(),
    startDate: date("start_date").notNull(),
    endDate: date("end_date"),
    ...timestampColumns,
  },
  (table) => [
    unique().on(table.jurisdictionId, table.externalSessionId),
    check(
      "legislative_sessions_dates_ordered",
      sql`${table.endDate} IS NULL OR ${table.endDate} >= ${table.startDate}`,
    ),
  ],
);

export const districts = pgTable(
  "districts",
  {
    ...idColumn,
    // No jurisdictionId — chamberId already implies it; same redundancy
    // fix as Term below.
    chamberId: uuid("chamber_id")
      .notNull()
      .references(() => chambers.id),
    externalDistrictId: text("external_district_id").notNull(),
    name: text("name"),
    validFrom: date("valid_from").notNull(),
    validTo: date("valid_to"),
    ...timestampColumns,
  },
  (table) => [
    unique().on(table.chamberId, table.externalDistrictId, table.validFrom),
    // Target of the composite FKs from terms/elections that keep a
    // district's chamber consistent with the row referencing it.
    unique().on(table.id, table.chamberId),
    check("districts_dates_ordered", sql`${table.validTo} IS NULL OR ${table.validTo} >= ${table.validFrom}`),
  ],
);

export const electionTypeEnum = pgEnum("election_type", [
  "general",
  "primary",
  "special",
  "runoff",
  "other",
]);

export const elections = pgTable(
  "elections",
  {
    ...idColumn,
    // jurisdictionId stays here (unlike terms/districts/votes) — chamberId
    // and districtId are both nullable on this table (a statewide race has
    // neither), so jurisdictionId isn't always derivable from them the way
    // it is elsewhere. Genuinely load-bearing, not redundant.
    jurisdictionId: uuid("jurisdiction_id")
      .notNull()
      .references(() => jurisdictions.id),
    // No column-level .references() on chamberId/districtId — the
    // composite FKs below are their FKs (and additionally check the
    // chamber belongs to the jurisdiction, and the district to the
    // chamber).
    chamberId: uuid("chamber_id"),
    districtId: uuid("district_id"),
    electionDate: date("election_date").notNull(),
    electionType: electionTypeEnum("election_type").notNull(),
    sourceItem: uuid("source_item")
      .notNull()
      .references(() => collectedItems.id),
    ...timestampColumns,
  },
  (table) => [
    // NULLS NOT DISTINCT: chamberId/districtId are nullable (a statewide
    // race has neither), and a plain UNIQUE treats NULLs as distinct — so
    // the same statewide race could be inserted any number of times.
    unique()
      .on(
        table.jurisdictionId,
        table.chamberId,
        table.districtId,
        table.electionDate,
        table.electionType,
      )
      .nullsNotDistinct(),
    // Composite FKs are MATCH SIMPLE: skipped when any column is NULL,
    // which is exactly right for a race with no chamber/district, and
    // enforced whenever both are present.
    foreignKey({
      name: "elections_chamber_in_jurisdiction_fk",
      columns: [table.chamberId, table.jurisdictionId],
      foreignColumns: [chambers.id, chambers.jurisdictionId],
    }),
    foreignKey({
      name: "elections_district_in_chamber_fk",
      columns: [table.districtId, table.chamberId],
      foreignColumns: [districts.id, districts.chamberId],
    }),
    // ...which leaves one hole: a district with no chamber would skip the
    // composite FK above entirely.
    check(
      "elections_district_requires_chamber",
      sql`${table.districtId} IS NULL OR ${table.chamberId} IS NOT NULL`,
    ),
    index("elections_district_idx").on(table.districtId),
  ],
);

export const candidacyOutcomeEnum = pgEnum("candidacy_outcome", ["won", "lost", "withdrew", "pending"]);

export const candidacies = pgTable(
  "candidacies",
  {
    ...idColumn,
    politicianId: uuid("politician_id")
      .notNull()
      .references((): AnyPgColumn => politicians.id),
    electionId: uuid("election_id")
      .notNull()
      .references(() => elections.id),
    // Nullable — same "only provenance + the identifying field are
    // required" principle as Term.party: a candidacy is still real and
    // worth recording before the party is known, or for a nonpartisan
    // race.
    party: text("party"),
    outcome: candidacyOutcomeEnum("outcome").notNull().default("pending"),
    sourceItem: uuid("source_item")
      .notNull()
      .references(() => collectedItems.id),
    ...timestampColumns,
  },
  (table) => [
    unique().on(table.politicianId, table.electionId),
    // Target of terms' composite FK, which guarantees a term's candidacy
    // is the same politician's.
    unique().on(table.id, table.politicianId),
    index("candidacies_election_idx").on(table.electionId),
  ],
);
