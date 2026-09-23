// Shared column helpers, so every table gets the same `id`/timestamp
// convention without repeating it — see SPEC.md "Aggregator output
// schema": "every entity gets a UUID `id` + `created_at`/`updated_at`,
// omitted below for brevity."

import { timestamp, uuid } from "drizzle-orm/pg-core";

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
