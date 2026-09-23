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
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};
