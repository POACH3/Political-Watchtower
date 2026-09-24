// "Committees & meetings" — see SPEC.md "Aggregator output schema". Same
// primary-source, no-review-gate category as the rest of Stage 1.

import { sql } from "drizzle-orm";
import { check, foreignKey, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { idColumn, timestampColumns } from "./_shared";
import { collectedItems } from "./collected-items";
import { chambers, jurisdictions } from "./jurisdictions";
import { politicians } from "./people";

export const committees = pgTable(
  "committees",
  {
    ...idColumn,
    jurisdictionId: uuid("jurisdiction_id")
      .notNull()
      .references(() => jurisdictions.id),
    // Nullable: a joint/interim committee spans both chambers. No
    // column-level .references() — the composite FK below is this
    // column's FK and also checks the chamber belongs to jurisdictionId.
    chamberId: uuid("chamber_id"),
    externalCommitteeId: text("external_committee_id").notNull(),
    name: text("name").notNull(),
    sourceItem: uuid("source_item")
      .notNull()
      .references(() => collectedItems.id),
    ...timestampColumns,
  },
  (table) => [
    unique().on(table.jurisdictionId, table.externalCommitteeId),
    foreignKey({
      name: "committees_chamber_in_jurisdiction_fk",
      columns: [table.chamberId, table.jurisdictionId],
      foreignColumns: [chambers.id, chambers.jurisdictionId],
    }),
  ],
);

// Membership has its own attribute (role), so it's not a bare
// many-to-many — same pattern as BillSponsor.
export const committeeMemberships = pgTable(
  "committee_memberships",
  {
    ...idColumn,
    committeeId: uuid("committee_id")
      .notNull()
      .references(() => committees.id),
    politicianId: uuid("politician_id")
      .notNull()
      .references(() => politicians.id),
    // Jurisdiction-defined ('chair' | 'vice_chair' | 'member' ...), kept
    // loose rather than a fixed enum until a second jurisdiction's data
    // shows what's actually portable.
    role: text("role"),
    sourceItem: uuid("source_item")
      .notNull()
      .references(() => collectedItems.id),
    ...timestampColumns,
  },
  (table) => [unique().on(table.committeeId, table.politicianId)],
);

// A scheduled committee meeting or chamber floor time — the meeting
// calendar and reading calendar are the same concept with different
// filters, not two entities.
export const meetings = pgTable(
  "meetings",
  {
    ...idColumn,
    committeeId: uuid("committee_id").references(() => committees.id),
    chamberId: uuid("chamber_id").references(() => chambers.id),
    externalMeetingId: text("external_meeting_id").notNull(),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    // Text, not a structured address — a committee room name isn't
    // geocodable data worth a real address model.
    location: text("location"),
    // Link, not a full-text mirror (same copyright-conscious call as
    // Bill.fullTextUrl).
    agendaUrl: text("agenda_url"),
    sourceItem: uuid("source_item")
      .notNull()
      .references(() => collectedItems.id),
    ...timestampColumns,
  },
  (table) => [
    // NULLS NOT DISTINCT is what makes this key work at all: exactly one
    // of committeeId/chamberId is always NULL (CHECK below), so under
    // default NULLs-distinct semantics this UNIQUE could never fire.
    unique().on(table.committeeId, table.chamberId, table.externalMeetingId).nullsNotDistinct(),
    // Exactly one of the two — a meeting is either one committee's or one
    // chamber's floor time, never both and never neither.
    check("meetings_exactly_one_owner", sql`num_nonnulls(${table.committeeId}, ${table.chamberId}) = 1`),
  ],
);
