// "Votes" — see SPEC.md "Aggregator output schema".

import { date, integer, pgEnum, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { idColumn, timestampColumns } from "./_shared";
import { collectedItems } from "./collected-items";
import { bills } from "./legislation";
import { chambers, jurisdictions, legislativeSessions } from "./jurisdictions";
import { politicians } from "./people";

export const voteResultEnum = pgEnum("vote_result", ["passed", "failed"]);

// The roll-call event itself, not any one politician's vote on it.
export const votes = pgTable(
  "votes",
  {
    ...idColumn,
    jurisdictionId: uuid("jurisdiction_id")
      .notNull()
      .references(() => jurisdictions.id),
    chamberId: uuid("chamber_id")
      .notNull()
      .references(() => chambers.id),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => legislativeSessions.id),
    // Without this, re-polling the same vote has no reliable dedup key —
    // matching on (billId, date, chamber, stage) isn't unique when a
    // bill gets two recorded votes at the same stage on the same day,
    // which happens — and the result is duplicated VoteRecords quietly
    // inflating every alignment/attendance number in Stage 6.
    externalVoteId: text("external_vote_id").notNull(),
    // Nullable because not every roll call is on a bill (procedural
    // votes, confirmations, resolutions); forcing this non-null means
    // the adapter either drops those votes (silently wrong
    // attendance-rate denominators) or fabricates a Bill row for
    // something that isn't one.
    billId: uuid("bill_id").references(() => bills.id),
    // Motion/resolution text, for votes with no bill, or to distinguish
    // multiple votes on the same bill at the same stage.
    description: text("description"),
    voteDate: date("vote_date").notNull(),
    voteStage: text("vote_stage").notNull(),
    result: voteResultEnum("result").notNull(),
    yeaCount: integer("yea_count").notNull(),
    nayCount: integer("nay_count").notNull(),
    otherCount: integer("other_count").notNull(),
    sourceItem: uuid("source_item")
      .notNull()
      .references(() => collectedItems.id),
    ...timestampColumns,
  },
  (table) => [unique().on(table.jurisdictionId, table.externalVoteId)],
);

export const voteValueEnum = pgEnum("vote_value", ["yea", "nay", "present", "absent", "excused"]);

// One politician's vote on one Vote.
export const voteRecords = pgTable(
  "vote_records",
  {
    ...idColumn,
    voteId: uuid("vote_id")
      .notNull()
      .references(() => votes.id),
    politicianId: uuid("politician_id")
      .notNull()
      .references(() => politicians.id),
    value: voteValueEnum("value").notNull(),
    // The jurisdiction's own value string, unnormalized.
    rawValue: text("raw_value").notNull(),
    sourceItem: uuid("source_item")
      .notNull()
      .references(() => collectedItems.id),
    ...timestampColumns,
  },
  // One politician can't have two votes on the same roll call.
  (table) => [unique().on(table.voteId, table.politicianId)],
);
