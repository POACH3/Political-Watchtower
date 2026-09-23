// The provenance envelope every collector's output conforms to — see
// SPEC.md "Data collector architecture".

import { boolean, pgEnum, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";
import { idColumn, timestampColumns } from "./_shared";

export const collectorTypeEnum = pgEnum("collector_type", ["manual_upload", "api_poll", "crawl"]);

export const intakeStatusEnum = pgEnum("intake_status", ["pending", "passed", "flagged", "rejected"]);

export const collectedItems = pgTable(
  "collected_items",
  {
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
    // Plain text, not jsonb — SPEC.md always said "jsonb/text," but jsonb
    // alone had two real problems: it rejects \u0000 outright (real
    // scraped HTML routinely has stray NUL bytes), and it re-serializes
    // (reorders keys, drops whitespace/duplicate keys), so the stored
    // value isn't byte-identical to what was fetched — which defeats the
    // whole point of contentHash being an integrity check. A JSON API
    // response is stored as its original response text, not a
    // re-serialized jsonb value; the aggregator parses it when it needs
    // structure.
    rawPayload: text("raw_payload").notNull(),
    intakeStatus: intakeStatusEnum("intake_status").notNull().default("pending"),
    // An admin's call on a flagged item survives the next validation pass
    // instead of being silently re-flagged forever — see "Review & audit".
    intakeLocked: boolean("intake_locked").notNull().default(false),
    ...timestampColumns,
  },
  // The exact-dedup key "Data collector architecture" describes — without
  // it, createCollectedItem was a bare INSERT with no dedup backstop at
  // all, and two overlapping polls could both write the same content.
  (table) => [unique().on(table.contentHash, table.sourceUrl)],
);
