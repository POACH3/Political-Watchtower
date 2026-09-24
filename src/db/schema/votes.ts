// "Votes" — see SPEC.md "Aggregator output schema".

import { date, foreignKey, index, integer, pgEnum, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { idColumn, timestampColumns } from "./_shared";
import { collectedItems } from "./collected-items";
import { bills } from "./legislation";
import { chambers, legislativeSessions } from "./jurisdictions";
import { politicians } from "./people";

export const voteResultEnum = pgEnum("vote_result", ["passed", "failed"]);

// The roll-call event itself, not any one politician's vote on it.
export const votes = pgTable(
  "votes",
  {
    ...idColumn,
    // No jurisdictionId — sessionId (and chamberId) already imply it,
    // same redundancy fix as Term/District. The original design used
    // UNIQUE (jurisdiction_id, external_vote_id) as the dedup key;
    // UNIQUE (session_id, external_vote_id) is the same guarantee
    // without the redundant column, and it's the same shape Bill
    // already uses for external_bill_id — one consistent pattern
    // instead of two.
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
    // No column-level .references() — the composite FK below is this
    // column's FK, and additionally guarantees the bill belongs to
    // sessionId. MATCH SIMPLE skips it when billId is NULL (procedural
    // votes), which is exactly right.
    billId: uuid("bill_id"),
    // Motion/resolution text, for votes with no bill, or to distinguish
    // multiple votes on the same bill at the same stage.
    description: text("description"),
    voteDate: date("vote_date").notNull(),
    // Nullable — descriptive, not identifying; only externalVoteId/
    // sessionId/chamberId are required to dedupe and place this row.
    voteStage: text("vote_stage"),
    result: voteResultEnum("result").notNull(),
    // Nullable, and now paired with a raw passthrough (below) — the
    // 2-value enum can't express "tied" / "no quorum" / "withdrawn",
    // which real jurisdictions report.
    yeaCount: integer("yea_count"),
    nayCount: integer("nay_count"),
    otherCount: integer("other_count"),
    // The jurisdiction's own outcome string, unnormalized — same
    // raw_status/raw_value pattern as Bill/VoteRecord, missing here
    // originally even though `result` has exactly the same normalization
    // problem those two fields exist to solve.
    rawResult: text("raw_result"),
    sourceItem: uuid("source_item")
      .notNull()
      .references(() => collectedItems.id),
    ...timestampColumns,
  },
  (table) => [
    unique().on(table.sessionId, table.externalVoteId),
    foreignKey({
      name: "votes_bill_in_session_fk",
      columns: [table.billId, table.sessionId],
      foreignColumns: [bills.id, bills.sessionId],
    }),
    index("votes_bill_idx").on(table.billId),
  ],
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
    // Nullable — the jurisdiction's own value string, unnormalized. Kept
    // required-in-spirit (every real vote record has one) but not
    // NOT NULL, since `value` itself is the field that actually has to
    // be known for this row to mean anything.
    rawValue: text("raw_value"),
    sourceItem: uuid("source_item")
      .notNull()
      .references(() => collectedItems.id),
    ...timestampColumns,
  },
  // One politician can't have two votes on the same roll call.
  (table) => [
    unique().on(table.voteId, table.politicianId),
    // "This politician's votes" — attendance/alignment/profile queries.
    index("vote_records_politician_idx").on(table.politicianId),
  ],
);
