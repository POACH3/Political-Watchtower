import { describe, expect, it } from "vitest";

describe("Stage 0 smoke test", () => {
  it("keeps the test pipeline non-empty until real tests land", () => {
    expect(true).toBe(true);
  });
});
