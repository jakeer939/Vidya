import { describe, expect, it } from "vitest";
import { filenameForHeader, parseRangeHeader } from "./pdf-range";

describe("PDF range parser", () => {
  it("serves the whole file when no Range header is present", () => {
    expect(parseRangeHeader(undefined, 1000)).toEqual({ kind: "full" });
    expect(parseRangeHeader("items=0-9", 1000)).toEqual({ kind: "full" });
  });

  it("parses a bounded byte range", () => {
    expect(parseRangeHeader("bytes=0-9", 1000)).toEqual({
      kind: "partial",
      start: 0,
      end: 9,
      length: 10,
      contentRange: "bytes 0-9/1000",
    });
  });

  it("parses an open-ended range and clamps the end", () => {
    expect(parseRangeHeader("bytes=990-", 1000)).toEqual({
      kind: "partial",
      start: 990,
      end: 999,
      length: 10,
      contentRange: "bytes 990-999/1000",
    });
    expect(parseRangeHeader("bytes=10-5000", 1000).kind).toBe("partial");
  });

  it("parses a suffix range", () => {
    expect(parseRangeHeader("bytes=-10", 1000)).toEqual({
      kind: "partial",
      start: 990,
      end: 999,
      length: 10,
      contentRange: "bytes 990-999/1000",
    });
  });

  it("rejects unsatisfiable and malformed ranges", () => {
    expect(parseRangeHeader("bytes=1000-", 1000)).toEqual({ kind: "unsatisfiable" });
    expect(parseRangeHeader("bytes=20-10", 1000)).toEqual({ kind: "unsatisfiable" });
    expect(parseRangeHeader("bytes=abc-def", 1000)).toEqual({ kind: "unsatisfiable" });
    expect(parseRangeHeader("bytes=-", 1000)).toEqual({ kind: "unsatisfiable" });
    expect(parseRangeHeader("bytes=0-9", 0)).toEqual({ kind: "full" });
  });

  it("ignores multi-range requests instead of rejecting them", () => {
    expect(parseRangeHeader("bytes=0-9,20-29", 1000)).toEqual({ kind: "full" });
  });

  it("sanitizes download filenames", () => {
    expect(filenameForHeader('quarterly "report".pdf')).toBe("quarterly _report_.pdf");
    expect(filenameForHeader("bad\r\nname.pdf")).toBe("bad__name.pdf");
    expect(filenameForHeader("")).toBe("document.pdf");
  });
});
