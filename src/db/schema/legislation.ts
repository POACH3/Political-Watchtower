// "Legislation" — see SPEC.md "Aggregator output schema".

import { date, pgEnum, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { idColumn, timestampColumns } from "./_shared";
import { collectedItems } from "./collected-items";
import { jurisdictions, legislativeSessions } from "./jurisdictions";
import { politicians } from "./people";

// Reference data, seeded once from the fixed ~10-15 taxonomy (Stage 1
// "Key decisions to confirm") — not itself aggregator output.
export const issueAreas = pgTable("issue_areas", {
  ...idColumn,
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  description: text("description"),
  ...timestampColumns,
});

export const billStatusEnum = pgEnum("bill_status", [
  "introduced",
  "in_committee",
  "passed_chamber",
  "passed_both",
  "signed",
  "vetoed",
  "failed",
]);

export const bills = pgTable(
  "bills",
  {
    ...idColumn,
    jurisdictionId: uuid("jurisdiction_id")
      .notNull()
      .references(() => jurisdictions.id),
    // Bill numbers get reused every session, so this (not jurisdictionId
    // alone) is what makes externalBillId actually unique.
    sessionId: uuid("session_id")
      .notNull()
      .references(() => legislativeSessions.id),
    externalBillId: text("external_bill_id").notNull(),
    title: text("title").notNull(),
    summaryText: text("summary_text"),
    // Link, not a full-text mirror — bill-text copyright status isn't
    // safe to assume across every jurisdiction this gets forked to.
    fullTextUrl: text("full_text_url"),
    introducedDate: date("introduced_date").notNull(),
    status: billStatusEnum("status").notNull(),
    // The jurisdiction's own status string, unnormalized, kept alongside
    // the enum for anything jurisdiction-specific the enum can't capture.
    rawStatus: text("raw_status").notNull(),
    sourceItem: uuid("source_item")
      .notNull()
      .references(() => collectedItems.id),
    ...timestampColumns,
  },
  (table) => [unique().on(table.sessionId, table.externalBillId)],
);

export const sponsorRoleEnum = pgEnum("sponsor_role", ["primary_sponsor", "cosponsor"]);

export const billSponsors = pgTable(
  "bill_sponsors",
  {
    ...idColumn,
    billId: uuid("bill_id")
      .notNull()
      .references(() => bills.id),
    politicianId: uuid("politician_id")
      .notNull()
      .references(() => politicians.id),
    role: sponsorRoleEnum("role").notNull(),
    // Every other government-record table has a sourceItem; sponsorship
    // is a factual assertion about a named person with no review gate,
    // so it shouldn't be the exception.
    sourceItem: uuid("source_item")
      .notNull()
      .references(() => collectedItems.id),
    ...timestampColumns,
  },
  (table) => [unique().on(table.billId, table.politicianId)],
);

export const taggingMethodEnum = pgEnum("tagging_method", ["keyword_mapping", "ml_classification"]);

// Entirely processor-owned; the aggregator never writes this table.
export const billIssueAreas = pgTable(
  "bill_issue_areas",
  {
    ...idColumn,
    billId: uuid("bill_id")
      .notNull()
      .references(() => bills.id),
    issueAreaId: uuid("issue_area_id")
      .notNull()
      .references(() => issueAreas.id),
    taggingMethod: taggingMethodEnum("tagging_method").notNull(),
    ...timestampColumns,
  },
  // Without this, a re-run of the tagger adds duplicate tags and the
  // Stage 6 radar chart double-counts.
  (table) => [unique().on(table.billId, table.issueAreaId)],
);
