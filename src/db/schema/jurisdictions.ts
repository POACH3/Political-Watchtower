// "Jurisdictions & elections" — see SPEC.md "Aggregator output schema".
// Added after an independent review found jurisdiction_id/chamber were
// free-form strings with no backing table on five other tables — see
// that section for the full rationale.

import { date, pgEnum, pgTable, text, unique, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
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
  // SPEC.md states this explicitly ("slug — unique within jurisdiction")
  // — missing from the original migration, not just untested.
  (table) => [unique().on(table.jurisdictionId, table.slug)],
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
  (table) => [unique().on(table.jurisdictionId, table.externalSessionId)],
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
  (table) => [unique().on(table.chamberId, table.externalDistrictId, table.validFrom)],
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
    chamberId: uuid("chamber_id").references(() => chambers.id),
    districtId: uuid("district_id").references(() => districts.id),
    electionDate: date("election_date").notNull(),
    electionType: electionTypeEnum("election_type").notNull(),
    sourceItem: uuid("source_item")
      .notNull()
      .references(() => collectedItems.id),
    ...timestampColumns,
  },
  (table) => [
    unique().on(
      table.jurisdictionId,
      table.chamberId,
      table.districtId,
      table.electionDate,
      table.electionType,
    ),
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
  (table) => [unique().on(table.politicianId, table.electionId)],
);
