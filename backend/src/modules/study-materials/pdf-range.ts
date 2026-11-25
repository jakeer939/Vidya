export type RangeResult =
  | { kind: "full" }
  | { kind: "partial"; start: number; end: number; length: number; contentRange: string }
  | { kind: "unsatisfiable" };

/**
 * Parses a single-range HTTP Range header for byte streaming.
 * Multi-range headers are ignored (served in full) rather than rejected.
 */
export const parseRangeHeader = (
  header: string | undefined,
  fileSize: number
): RangeResult => {
  if (!header || fileSize <= 0 || !header.trim().startsWith("bytes=")) {
    return { kind: "full" };
  }

  const spec = header.trim().slice("bytes=".length).trim();
  if (spec.includes(",")) return { kind: "full" };

  const match = /^(\d*)-(\d*)$/.exec(spec);
  if (!match || (!match[1] && !match[2])) return { kind: "unsatisfiable" };

  let start: number;
  let end: number;

  if (!match[1]) {
    // Suffix range: last N bytes.
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return { kind: "unsatisfiable" };
    start = Math.max(0, fileSize - suffix);
    end = fileSize - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : fileSize - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) {
      return { kind: "unsatisfiable" };
    }
    if (start >= fileSize || start > end) return { kind: "unsatisfiable" };
    end = Math.min(end, fileSize - 1);
  }

  return {
    kind: "partial",
    start,
    end,
    length: end - start + 1,
    contentRange: `bytes ${start}-${end}/${fileSize}`,
  };
};

/** Keep Content-Disposition headers safe from CRLF/quote injection. */
export const filenameForHeader = (originalFilename: string): string =>
  originalFilename.replace(/[\r\n"\\]/g, "_").slice(0, 255) || "document.pdf";
