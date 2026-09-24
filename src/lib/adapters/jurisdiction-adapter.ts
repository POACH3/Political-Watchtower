// The collector contract for government sources — see SPEC.md
// "Cross-cutting architecture decisions" #3. Real implementation for the
// pilot state is Stage 3; this file only defines the interface plus a
// mock so Stage 3+ has something concrete to build against and the UI
// (Stage 5) can be developed in parallel against fake data.
//
// Shapes here are what a collector fetches, in the source's own
// vocabulary (external IDs, raw status/vote-value strings) — not DB
// rows. Resolving those into real UUIDs/FKs is the aggregator's job.
//
// Provenance: every fetchX returns `Collected<T>[]` — records paired with
// the verbatim response they were parsed from (`SourceSnapshot`), one
// entry per underlying HTTP response. Adapters never touch the database;
// the aggregator writes one `CollectedItem` per snapshot and stamps every
// record parsed from it with that row's id as its `source_item`. Without
// the snapshot, no government-record row could satisfy its NOT NULL
// `source_item`.

import type { Collected, Collector } from "@/lib/pipeline/types";

export interface RawSession {
  externalSessionId: string;
  startDate: string; // ISO date
  endDate?: string; // ISO date
}

export interface RawChamber {
  slug: string;
  name: string;
}

export interface RawDistrict {
  chamberSlug: string;
  externalDistrictId: string;
  name?: string;
  validFrom: string; // ISO date
  validTo?: string; // ISO date; omitted = currently in effect
}

export interface RawLegislator {
  externalId: string;
  fullName: string;
  photoUrl?: string;
  bioText?: string;
  birthDate?: string; // ISO date
  chamberSlug: string;
  districtExternalId: string;
  party?: string;
  termStartDate: string; // ISO date
  termEndDate?: string; // ISO date; omitted = currently serving
}

export interface RawBillSponsor {
  legislatorExternalId: string;
  role?: "primary_sponsor" | "cosponsor" | "other";
}

export interface RawBill {
  externalBillId: string;
  sessionExternalId: string;
  title?: string;
  summaryText?: string;
  fullTextUrl?: string;
  introducedDate?: string; // ISO date
  rawStatus?: string;
  // The source's own topic/subject strings, if it provides them — a
  // strong input for issue-area tagging, but the schema has no aggregator-
  // owned home for them (BillIssueArea is processor-only). The tagging
  // processor reads them back out of the bill's CollectedItem.raw_payload;
  // they're surfaced here so an adapter author knows to keep the payload.
  subjects?: string[];
  sponsors: RawBillSponsor[];
}

export interface RawVoteRecord {
  legislatorExternalId: string;
  rawValue?: string;
}

export interface RawVote {
  externalVoteId: string;
  billExternalId?: string;
  chamberSlug: string;
  sessionExternalId: string;
  description?: string;
  voteDate: string; // ISO date
  voteStage?: string;
  rawResult: string;
  records: RawVoteRecord[];
}

export interface RawCommitteeMembership {
  legislatorExternalId: string;
  role?: string; // jurisdiction-defined, e.g. 'chair'
}

export interface RawCommittee {
  externalCommitteeId: string;
  chamberSlug?: string; // omitted for a joint/interim committee
  name: string;
  memberships: RawCommitteeMembership[];
}

export interface RawMeeting {
  externalMeetingId: string;
  // Exactly one of the two: a committee meeting or a chamber floor session.
  committeeExternalId?: string;
  chamberSlug?: string;
  scheduledAt: string; // ISO timestamp
  location?: string;
  agendaUrl?: string;
}

export interface RawCandidacy {
  candidateExternalId: string; // same id space as RawLegislator.externalId
  party?: string;
  outcome?: "won" | "lost" | "withdrew" | "pending";
}

export interface RawElection {
  chamberSlug?: string; // omitted for a statewide/at-large race
  districtExternalId?: string;
  electionDate: string; // ISO date
  electionType: "general" | "primary" | "special" | "runoff" | "other";
  candidacies: RawCandidacy[];
}

/**
 * What `collect()` yields: one tagged record per parsed item, so a single
 * full sync can flow through the same `Collected<T>` envelope every other
 * collector (Stage 8's RSS/GDELT/oEmbed) uses. Batches come back in
 * foreign-key dependency order — sessions, chambers, districts,
 * legislators, committees, meetings, bills, votes, elections — so an
 * aggregator can process them in order without a second pass.
 */
export type RawRecord =
  | { kind: "session"; data: RawSession }
  | { kind: "chamber"; data: RawChamber }
  | { kind: "district"; data: RawDistrict }
  | { kind: "legislator"; data: RawLegislator }
  | { kind: "committee"; data: RawCommittee }
  | { kind: "meeting"; data: RawMeeting }
  | { kind: "bill"; data: RawBill }
  | { kind: "vote"; data: RawVote }
  | { kind: "election"; data: RawElection };

// Extends Collector (see "Four-layer modular pipeline") rather than
// sitting alongside it disconnected. `collect()` is the full-sync entry
// point (every fetchX below, in dependency order); the specific fetchX
// methods remain available for finer-grained operations (e.g. the Stage 4
// admin GUI refreshing just one thing).
export interface JurisdictionAdapter extends Collector<RawRecord> {
  readonly jurisdictionSlug: string;
  fetchSessions(): Promise<Collected<RawSession>[]>;
  fetchChambers(): Promise<Collected<RawChamber>[]>;
  fetchDistricts(): Promise<Collected<RawDistrict>[]>;
  fetchLegislators(): Promise<Collected<RawLegislator>[]>;
  fetchCommittees(): Promise<Collected<RawCommittee>[]>;
  fetchMeetings(): Promise<Collected<RawMeeting>[]>;
  fetchBills(sessionExternalId: string): Promise<Collected<RawBill>[]>;
  // Roll-call data isn't published by every jurisdiction (the pilot state
  // is one — see SPEC.md Stage 3), so a manual-upload-only path has to be
  // able to stand in; an adapter with no vote source returns [].
  fetchVotes(sessionExternalId: string): Promise<Collected<RawVote>[]>;
  // Optional: not every source publishes elections/candidacies.
  fetchElections?(): Promise<Collected<RawElection>[]>;
}

// --- Mock adapter — fake data, no network calls ---

const mockSessions: RawSession[] = [{ externalSessionId: "2026-mock-session", startDate: "2026-01-01" }];

const mockChambers: RawChamber[] = [
  { slug: "house", name: "House" },
  { slug: "senate", name: "Senate" },
];

const mockDistricts: RawDistrict[] = [
  { chamberSlug: "house", externalDistrictId: "D1", validFrom: "2020-01-01" },
  { chamberSlug: "senate", externalDistrictId: "D2", validFrom: "2020-01-01" },
];

const mockLegislators: RawLegislator[] = [
  {
    externalId: "mock-001",
    fullName: "Jordan Ellis",
    party: "Independent",
    chamberSlug: "house",
    districtExternalId: "D1",
    termStartDate: "2023-01-01",
  },
  {
    externalId: "mock-002",
    fullName: "Sam Rivera",
    party: "Independent",
    chamberSlug: "senate",
    districtExternalId: "D2",
    termStartDate: "2023-01-01",
  },
];

const mockBills: RawBill[] = [
  {
    externalBillId: "HB 1",
    sessionExternalId: "2026-mock-session",
    title: "An Act Concerning Mock Legislation",
    introducedDate: "2026-01-15",
    rawStatus: "Passed 3rd Reading",
    sponsors: [{ legislatorExternalId: "mock-001", role: "primary_sponsor" }],
  },
];

const mockVotes: RawVote[] = [
  {
    externalVoteId: "vote-001",
    billExternalId: "HB 1",
    chamberSlug: "house",
    sessionExternalId: "2026-mock-session",
    voteDate: "2026-02-01",
    voteStage: "third_reading",
    rawResult: "PASSED",
    records: [
      { legislatorExternalId: "mock-001", rawValue: "Yea" },
      { legislatorExternalId: "mock-002", rawValue: "Nay" },
    ],
  },
];

const mockCommittees: RawCommittee[] = [
  {
    externalCommitteeId: "C1",
    chamberSlug: "house",
    name: "Mock Judiciary Committee",
    memberships: [{ legislatorExternalId: "mock-001", role: "chair" }],
  },
];

const mockMeetings: RawMeeting[] = [
  {
    externalMeetingId: "M1",
    committeeExternalId: "C1",
    scheduledAt: "2026-02-10T15:00:00Z",
    location: "Room 100",
  },
  { externalMeetingId: "F1", chamberSlug: "senate", scheduledAt: "2026-02-11T16:00:00Z" },
];

const MOCK_BASE_URL = "mock://mock-state";

// Wraps parsed records in the snapshot they "came from" — for the mock,
// the JSON text of the records themselves stands in for a raw response.
function mockBatch<T>(path: string, records: T[]): Collected<T>[] {
  return [
    {
      snapshot: {
        sourceUrl: `${MOCK_BASE_URL}/${path}`,
        contentType: "application/json",
        rawPayload: JSON.stringify(records),
      },
      records,
    },
  ];
}

function tagged<T, K extends RawRecord["kind"]>(kind: K, batches: Collected<T>[]): Collected<RawRecord>[] {
  return batches.map((batch) => ({
    snapshot: batch.snapshot,
    records: batch.records.map((data) => ({ kind, data }) as unknown as RawRecord),
  }));
}

export const mockJurisdictionAdapter: JurisdictionAdapter = {
  collectorId: "mock-jurisdiction-adapter",
  collectorType: "api_poll",
  jurisdictionSlug: "mock-state",
  async collect() {
    const sessions = await this.fetchSessions();
    const votes = await Promise.all(
      sessions.flatMap((batch) => batch.records).map((session) => this.fetchVotes(session.externalSessionId)),
    );
    const bills = await Promise.all(
      sessions.flatMap((batch) => batch.records).map((session) => this.fetchBills(session.externalSessionId)),
    );
    return [
      ...tagged("session", sessions),
      ...tagged("chamber", await this.fetchChambers()),
      ...tagged("district", await this.fetchDistricts()),
      ...tagged("legislator", await this.fetchLegislators()),
      ...tagged("committee", await this.fetchCommittees()),
      ...tagged("meeting", await this.fetchMeetings()),
      ...tagged("bill", bills.flat()),
      ...tagged("vote", votes.flat()),
    ];
  },
  async fetchSessions() {
    return mockBatch("sessions", mockSessions);
  },
  async fetchChambers() {
    return mockBatch("chambers", mockChambers);
  },
  async fetchDistricts() {
    return mockBatch("districts", mockDistricts);
  },
  async fetchLegislators() {
    return mockBatch("legislators", mockLegislators);
  },
  async fetchCommittees() {
    return mockBatch("committees", mockCommittees);
  },
  async fetchMeetings() {
    return mockBatch("meetings", mockMeetings);
  },
  async fetchBills(sessionExternalId) {
    return mockBatch(
      `sessions/${sessionExternalId}/bills`,
      mockBills.filter((bill) => bill.sessionExternalId === sessionExternalId),
    );
  },
  async fetchVotes(sessionExternalId) {
    return mockBatch(
      `sessions/${sessionExternalId}/votes`,
      mockVotes.filter((vote) => vote.sessionExternalId === sessionExternalId),
    );
  },
};
