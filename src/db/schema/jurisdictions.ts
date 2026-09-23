// "Jurisdictions & elections" — see SPEC.md "Aggregator output schema".
// Added after an independent review found jurisdiction_id/chamber were
// free-form strings with no backing table on five other tables — see
// that section for the full rationale.

import { date, pgEnum, pgTable, text, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import { idColumn, timestampColumns } from "./_shared";
import { collectedItems } from "./collected-items";
import { politicians } from "./people";

export const jurisdictionLevelEnum = pgEnum("jurisdiction_level", ["federal", "state", "local"]);

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

export const chambers = pgTable("chambers", {
  ...idColumn,
  jurisdictionId: uuid("jurisdiction_id")
    .notNull()
    .references(() => jurisdictions.id),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  ...timestampColumns,
});

export const legislativeSessions = pgTable("legislative_sessions", {
  ...idColumn,
  jurisdictionId: uuid("jurisdiction_id")
    .notNull()
    .references(() => jurisdictions.id),
  externalSessionId: text("external_session_id").notNull(),
  startDate: date("start_date").notNull(),
  endDate: date("end_date"),
  ...timestampColumns,
});

export const districts = pgTable("districts", {
  ...idColumn,
  jurisdictionId: uuid("jurisdiction_id")
    .notNull()
    .references(() => jurisdictions.id),
  chamberId: uuid("chamber_id")
    .notNull()
    .references(() => chambers.id),
  externalDistrictId: text("external_district_id").notNull(),
  name: text("name"),
  validFrom: date("valid_from").notNull(),
  validTo: date("valid_to"),
  ...timestampColumns,
});

export const electionTypeEnum = pgEnum("election_type", ["general", "primary", "special", "runoff"]);

export const elections = pgTable("elections", {
  ...idColumn,
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
});

export const candidacyOutcomeEnum = pgEnum("candidacy_outcome", ["won", "lost", "withdrew", "pending"]);

export const candidacies = pgTable("candidacies", {
  ...idColumn,
  politicianId: uuid("politician_id")
    .notNull()
    .references((): AnyPgColumn => politicians.id),
  electionId: uuid("election_id")
    .notNull()
    .references(() => elections.id),
  party: text("party").notNull(),
  outcome: candidacyOutcomeEnum("outcome").notNull().default("pending"),
  sourceItem: uuid("source_item")
    .notNull()
    .references(() => collectedItems.id),
  ...timestampColumns,
});
