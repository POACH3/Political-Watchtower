import { describe, expect, it } from "vitest";
import { mockJurisdictionAdapter } from "./jurisdiction-adapter";

describe("mockJurisdictionAdapter", () => {
  it("returns fake legislators, bills, and votes with no network calls", async () => {
    const legislators = (await mockJurisdictionAdapter.fetchLegislators()).flatMap((b) => b.records);
    expect(legislators.length).toBeGreaterThan(0);

    const bills = (await mockJurisdictionAdapter.fetchBills("2026-mock-session")).flatMap((b) => b.records);
    expect(bills.length).toBeGreaterThan(0);

    const votes = (await mockJurisdictionAdapter.fetchVotes("2026-mock-session")).flatMap((b) => b.records);
    expect(votes.length).toBeGreaterThan(0);
    expect(votes[0].records.length).toBeGreaterThan(0);
  });

  it("filters by session, so an unknown session returns nothing", async () => {
    const bills = (await mockJurisdictionAdapter.fetchBills("no-such-session")).flatMap((b) => b.records);
    expect(bills).toHaveLength(0);
  });

  it("returns committees and meetings, including a floor session with no committee", async () => {
    const committees = (await mockJurisdictionAdapter.fetchCommittees()).flatMap((b) => b.records);
    expect(committees[0].memberships.length).toBeGreaterThan(0);

    const meetings = (await mockJurisdictionAdapter.fetchMeetings()).flatMap((b) => b.records);
    expect(meetings.some((m) => m.chamberSlug && !m.committeeExternalId)).toBe(true);
  });

  it("pairs every batch with the verbatim snapshot its records were parsed from", async () => {
    for (const batch of await mockJurisdictionAdapter.fetchLegislators()) {
      expect(batch.snapshot.sourceUrl).toMatch(/^mock:\/\//);
      expect(JSON.parse(batch.snapshot.rawPayload)).toEqual(batch.records);
    }
  });

  it("collect() yields tagged records for every entity kind, sessions before anything that references them", async () => {
    const batches = await mockJurisdictionAdapter.collect();
    const kinds = batches.flatMap((b) => b.records.map((r) => r.kind));
    expect(new Set(kinds)).toEqual(
      new Set(["session", "chamber", "district", "legislator", "committee", "meeting", "bill", "vote"]),
    );
    expect(kinds.indexOf("session")).toBeLessThan(kinds.indexOf("bill"));
    expect(kinds.indexOf("legislator")).toBeLessThan(kinds.indexOf("vote"));
  });
});
