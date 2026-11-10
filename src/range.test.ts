import { describe, expect, it } from "vitest";
import { parseRange } from "./range";

describe("parseRange", () => {
  const size = 1000;

  it("returns null when there is no Range header", () => {
    expect(parseRange(null, size)).toBeNull();
  });

  it("parses a closed range", () => {
    expect(parseRange("bytes=0-99", size)).toEqual({ start: 0, end: 99 });
  });

  it("clamps the end to the last byte", () => {
    expect(parseRange("bytes=900-5000", size)).toEqual({ start: 900, end: 999 });
  });

  it("parses an open-ended range", () => {
    expect(parseRange("bytes=500-", size)).toEqual({ start: 500, end: 999 });
  });

  it("parses a suffix range", () => {
    expect(parseRange("bytes=-100", size)).toEqual({ start: 900, end: 999 });
  });

  it("treats a suffix longer than the file as the whole file", () => {
    expect(parseRange("bytes=-5000", size)).toEqual({ start: 0, end: 999 });
  });

  it("rejects a start beyond the end of the file", () => {
    expect(parseRange("bytes=1000-1099", size)).toBe("unsatisfiable");
  });

  it("rejects an inverted range", () => {
    expect(parseRange("bytes=50-10", size)).toBe("unsatisfiable");
  });

  it("rejects multiple ranges, which pmtiles never sends", () => {
    expect(parseRange("bytes=0-1,5-6", size)).toBe("unsatisfiable");
  });

  it("rejects garbage", () => {
    expect(parseRange("items=0-1", size)).toBe("unsatisfiable");
  });
});
