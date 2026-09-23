import { describe, expect, it } from "vitest";
import { mockJurisdictionAdapter } from "./jurisdiction-adapter";

describe("mockJurisdictionAdapter", () => {
  it("returns fake legislators, bills, and votes with no network calls", async () => {
    const legislators = await mockJurisdictionAdapter.fetchLegislators();
    expect(legislators.length).toBeGreaterThan(0);

    const bills = await mockJurisdictionAdapter.fetchBills("2026-mock-session");
    expect(bills.length).toBeGreaterThan(0);

    const votes = await mockJurisdictionAdapter.fetchVotes("2026-mock-session");
    expect(votes.length).toBeGreaterThan(0);
    expect(votes[0].records.length).toBeGreaterThan(0);
  });

  it("filters by session, so an unknown session returns nothing", async () => {
    const bills = await mockJurisdictionAdapter.fetchBills("no-such-session");
    expect(bills).toHaveLength(0);
  });
});
