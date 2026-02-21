/**
 * Parse a year from a date string, handling BC notation, formal dates, empty strings, and NaN.
 * Accepts formats like "1979", "31 July 1979", "1979-07-31", "100 BC", "+1523", "-0500", "?".
 * Returns a negative number for BC years and negative formal dates.
 */
export function parseYear(dateStr: string | undefined | null): number | null {
  if (!dateStr) return null;
  const cleaned = dateStr.trim();
  if (!cleaned || cleaned === '?') return null;

  const bcMatch = cleaned.match(/(\d+)\s*BC/i);
  if (bcMatch) {
    const num = parseInt(bcMatch[1], 10);
    return isNaN(num) ? null : -num;
  }

  // Handle formal dates like +1523 or -0500
  const formalMatch = cleaned.match(/^([+-]?)(\d+)/);
  if (formalMatch) {
    const sign = formalMatch[1] === '-' ? -1 : 1;
    const num = parseInt(formalMatch[2], 10);
    return isNaN(num) ? null : sign * num;
  }

  // Match 3-4 digit year patterns
  const yearMatch = cleaned.match(/\b(\d{3,4})\b/);
  if (yearMatch) {
    const num = parseInt(yearMatch[1], 10);
    return isNaN(num) ? null : num;
  }

  return null;
}
