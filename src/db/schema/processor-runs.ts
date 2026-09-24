// "Provenance chain & processor accountability" — see SPEC.md. Every
// processor invocation is a real row, so "what ran, when, against what,
// with what config" is answerable for processors the same way
// CollectorJob (Stage 4) answers it for collectors. Claim and Promise
// carry a nullable processor_run_id FK instead of an inline
// model_version — the version is derivable through the join, not
// duplicated per row.

import { sql } from "drizzle-orm";
import { check, index, jsonb, pgEnum, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { idColumn, timestampColumns } from "./_shared";

export const processorRunStatusEnum = pgEnum("processor_run_status", ["running", "succeeded", "failed"]);

export const processorRuns = pgTable(
  "processor_runs",
  {
    ...idColumn,
    // e.g. 'claim-extraction', 'issue-area-tagging', 'promise-tracking'.
    processorName: text("processor_name").notNull(),
    // This processor's own code version, independent of any model it calls.
    processorVersion: text("processor_version").notNull(),
    // The LLM/model identifier+version, for processors that use one.
    modelVersion: text("model_version"),
    // The actual prompt template/config used — reproducibility needs the
    // exact input, not just a version label. jsonb: shape varies by
    // processor and is never joined or filtered on.
    config: jsonb("config").notNull(),
    // What this run actually processed (one CollectedItem id, a batch, a
    // politician id...). Same reasoning as ReviewAction.previous_value.
    inputRef: jsonb("input_ref").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    status: processorRunStatusEnum("status").notNull().default("running"),
    // Structured stats (rows written, confidence range, errors), not a
    // parsed free-text log.
    summary: jsonb("summary"),
    ...timestampColumns,
  },
  (table) => [
    check(
      "processor_runs_finished_after_started",
      sql`${table.finishedAt} IS NULL OR ${table.finishedAt} >= ${table.startedAt}`,
    ),
    // A run is 'running' exactly while it has no finish time.
    check(
      "processor_runs_status_matches_finished_at",
      sql`(${table.status} = 'running') = (${table.finishedAt} IS NULL)`,
    ),
    index("processor_runs_name_started_idx").on(table.processorName, table.startedAt),
  ],
);
