// The provenance envelope every collector's output conforms to — see
// SPEC.md "Data collector architecture".

import { boolean, jsonb, pgEnum, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { idColumn, timestampColumns } from "./_shared";

export const collectorTypeEnum = pgEnum("collector_type", ["manual_upload", "api_poll", "crawl"]);

export const intakeStatusEnum = pgEnum("intake_status", ["pending", "passed", "flagged", "rejected"]);

export const collectedItems = pgTable("collected_items", {
  ...idColumn,
  collectorType: collectorTypeEnum("collector_type").notNull(),
  collectorId: text("collector_id").notNull(),
  sourceUrl: text("source_url").notNull(),
  submittedBy: text("submitted_by").notNull(),
  sourceTimestamp: timestamp("source_timestamp", { withTimezone: true }),
  retrievedTimestamp: timestamp("retrieved_timestamp", { withTimezone: true }).notNull().defaultNow(),
  contentHash: text("content_hash").notNull(),
  // MIME type — how to interpret rawPayload (application/json for an API
  // poll, text/html for a crawled page, application/pdf/image/* for an
  // upload via a stored-file reference rather than inline bytes).
  contentType: text("content_type").notNull(),
  rawPayload: jsonb("raw_payload").notNull(),
  intakeStatus: intakeStatusEnum("intake_status").notNull().default("pending"),
  // An admin's call on a flagged item survives the next validation pass
  // instead of being silently re-flagged forever — see "Review & audit".
  intakeLocked: boolean("intake_locked").notNull().default(false),
  ...timestampColumns,
});
