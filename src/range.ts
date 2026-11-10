/** An inclusive byte range, as in the HTTP Range header. */
export interface ByteRange {
  start: number;
  end: number;
}

/**
 * Parse a single-range `Range: bytes=...` header against a file of `size` bytes.
 *
 * Returns null when there is no header (serve the whole file), and
 * "unsatisfiable" when the header cannot be honoured (answer 416).
 * pmtiles.js only ever sends one closed range, but the open and suffix forms
 * are cheap to support and make the worker usable with other clients.
 */
export function parseRange(header: string | null, size: number): ByteRange | null | "unsatisfiable" {
  if (header === null) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return "unsatisfiable";
  const [, a, b] = m;
  if (a === "" && b === "") return "unsatisfiable";
  if (a === "") {
    const n = Number(b);
    if (n === 0) return "unsatisfiable";
    return { start: Math.max(0, size - n), end: size - 1 };
  }
  const start = Number(a);
  const end = b === "" ? size - 1 : Math.min(Number(b), size - 1);
  if (start >= size || start > end) return "unsatisfiable";
  return { start, end };
}
