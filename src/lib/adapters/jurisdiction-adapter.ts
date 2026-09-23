// The collector contract for government sources — see SPEC.md
// "Cross-cutting architecture decisions" #3. Real implementation for the
// pilot state is Stage 3; this file only defines the interface plus a
// mock so Stage 3+ has something concrete to build against and the UI
// (Stage 5) can be developed in parallel against fake data.
//
// Shapes here are what a collector fetches, in the source's own
// vocabulary (external IDs, raw status/vote-value strings) — not DB
// rows. Resolving those into real UUIDs/FKs is the aggregator's job.

import type { Collector } from "@/lib/pipeline/types";

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

// Extends Collector (see "Four-layer modular pipeline") rather than
// sitting alongside it disconnected — a second independent review found
// the two interfaces had no relationship at all in the original design,
// which meant nothing actually tied a JurisdictionAdapter to the
// collector contract SPEC.md says it implements. `collect()` here is a
// convenience full-sync entry point (fetch legislators, the baseline any
// sync needs); the specific fetchX methods remain available for
// finer-grained operations (e.g. the Stage 4 admin GUI refreshing just
// one thing). Stage 3 will likely expand collect()'s orchestration once
// there's a real sync loop to design it against — this only fixes the
// interfaces being connected at all, not the full sync strategy.
export interface JurisdictionAdapter extends Collector<RawLegislator> {
  readonly jurisdictionSlug: string;
  fetchSessions(): Promise<RawSession[]>;
  fetchChambers(): Promise<RawChamber[]>;
  fetchDistricts(): Promise<RawDistrict[]>;
  fetchLegislators(): Promise<RawLegislator[]>;
  fetchBills(sessionExternalId: string): Promise<RawBill[]>;
  fetchVotes(sessionExternalId: string): Promise<RawVote[]>;
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

export const mockJurisdictionAdapter: JurisdictionAdapter = {
  collectorId: "mock-jurisdiction-adapter",
  collectorType: "api_poll",
  jurisdictionSlug: "mock-state",
  async collect() {
    return mockLegislators;
  },
  async fetchSessions() {
    return mockSessions;
  },
  async fetchChambers() {
    return mockChambers;
  },
  async fetchDistricts() {
    return mockDistricts;
  },
  async fetchLegislators() {
    return mockLegislators;
  },
  async fetchBills(sessionExternalId) {
    return mockBills.filter((bill) => bill.sessionExternalId === sessionExternalId);
  },
  async fetchVotes(sessionExternalId) {
    return mockVotes.filter((vote) => vote.sessionExternalId === sessionExternalId);
  },
};
