import { describe, expect, it } from "vitest";
import { hashPayload, normalizeUrl } from "./normalize";

describe("normalizeUrl", () => {
  it("lowercases scheme/host, drops default port and fragment, keeps the query untouched", () => {
    expect(normalizeUrl("HTTPS://Example.COM:443/a/b?z=1&a=2#frag")).toBe("https://example.com/a/b?z=1&a=2");
  });

  it("passes non-http identifiers through trimmed", () => {
    expect(normalizeUrl("  upload://batch-7/file.pdf ")).toBe("upload://batch-7/file.pdf");
    expect(normalizeUrl("not a url")).toBe("not a url");
  });
});

describe("hashPayload", () => {
  it("is a stable sha-256 hex digest", () => {
    expect(hashPayload("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
