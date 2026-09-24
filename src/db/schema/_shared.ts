// Shared column helpers, so every table gets the same `id`/timestamp
// convention without repeating it — see SPEC.md "Aggregator output
// schema": "every entity gets a UUID `id` + `created_at`/`updated_at`,
// omitted below for brevity."

import { sql } from "drizzle-orm";
import { check, timestamp, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";

export const idColumn = {
  id: uuid("id").primaryKey().defaultRandom(),
};

export const timestampColumns = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  // Kept current by a BEFORE UPDATE trigger (migrations/0002_updated_at_trigger.sql),
  // not application code — a trigger, unlike Drizzle's own $onUpdate,
  // also covers any raw-SQL write path, not just ones that go through
  // this ORM. defaultNow() here only sets the *initial* value.
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

// For append-only audit tables (ReviewAction, SuppressionRule) — no
// updatedAt/trigger on these deliberately: an "edited" timestamp on a
// row that exists specifically to record an immutable past action would
// invite the kind of after-the-fact edit an audit trail exists to rule
// out.
export const createdAtColumn = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
};

// Soft-suppression fields (Claim, NewsItem) must agree with each other:
// a suppressed row always carries when/why, an unsuppressed one never
// does. Without this, `is_suppressed = true` with no timestamp/reason
// was accepted — and suppression is a legal control (see SPEC.md
// "Retraction & suppression"), so an unexplained one is a defect.
// Clearing suppression clears both fields; the history of that lives in
// ReviewAction, not on the row.
export function suppressionConsistentCheck(
  name: string,
  t: { isSuppressed: AnyPgColumn; suppressedAt: AnyPgColumn; suppressionReason: AnyPgColumn },
) {
  return check(
    name,
    sql`(${t.isSuppressed} AND ${t.suppressedAt} IS NOT NULL AND ${t.suppressionReason} IS NOT NULL AND length(btrim(${t.suppressionReason})) > 0) OR (NOT ${t.isSuppressed} AND ${t.suppressedAt} IS NULL AND ${t.suppressionReason} IS NULL)`,
  );
}
