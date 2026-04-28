/**
 * Normalize a place string for cross-provider comparison.
 *
 * Genealogy providers spell places differently for the same location:
 *   - "Dallas, Texas, USA" vs "Dallas, Texas, United States"
 *   - "London, England, UK" vs "London, England, United Kingdom"
 *   - "Paris, France." vs " Paris,  France "
 *   - "Dallas, TX, USA" vs "Dallas, Texas, USA"
 *
 * Without normalization these all flag as "different" in the comparison UI
 * even though they describe the same place. This module canonicalizes the
 * common alias variants so genuine differences (a different city, a
 * different country) still surface.
 *
 * Goals:
 *   - Idempotent: normalize(normalize(x)) === normalize(x)
 *   - Conservative: only collapse aliases that are unambiguous
 *   - Lossless ordering: keep the comma-delimited segments in original order
 */

// Aliases are matched after trailing dots are stripped, so entries here
// should be the dot-free form ("u.s.a" — not "u.s.a.").
const COUNTRY_ALIASES: Record<string, string> = {
  'usa': 'united states',
  'u.s.a': 'united states',
  'u.s': 'united states',
  'united states of america': 'united states',
  'uk': 'united kingdom',
  'u.k': 'united kingdom',
  'great britain': 'united kingdom',
  'ussr': 'soviet union',
  'u.s.s.r': 'soviet union',
};

const US_STATE_ABBREVIATIONS: Record<string, string> = {
  'al': 'alabama', 'ak': 'alaska', 'az': 'arizona', 'ar': 'arkansas',
  'ca': 'california', 'co': 'colorado', 'ct': 'connecticut', 'de': 'delaware',
  'fl': 'florida', 'ga': 'georgia', 'hi': 'hawaii', 'id': 'idaho',
  'il': 'illinois', 'in': 'indiana', 'ia': 'iowa', 'ks': 'kansas',
  'ky': 'kentucky', 'la': 'louisiana', 'me': 'maine', 'md': 'maryland',
  'ma': 'massachusetts', 'mi': 'michigan', 'mn': 'minnesota', 'ms': 'mississippi',
  'mo': 'missouri', 'mt': 'montana', 'ne': 'nebraska', 'nv': 'nevada',
  'nh': 'new hampshire', 'nj': 'new jersey', 'nm': 'new mexico', 'ny': 'new york',
  'nc': 'north carolina', 'nd': 'north dakota', 'oh': 'ohio', 'ok': 'oklahoma',
  'or': 'oregon', 'pa': 'pennsylvania', 'ri': 'rhode island', 'sc': 'south carolina',
  'sd': 'south dakota', 'tn': 'tennessee', 'tx': 'texas', 'ut': 'utah',
  'vt': 'vermont', 'va': 'virginia', 'wa': 'washington', 'wv': 'west virginia',
  'wi': 'wisconsin', 'wy': 'wyoming', 'dc': 'district of columbia',
};

function canonicalizeSegment(segment: string): string {
  const cleaned = segment
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '');

  if (!cleaned) return '';

  if (COUNTRY_ALIASES[cleaned]) return COUNTRY_ALIASES[cleaned];
  if (US_STATE_ABBREVIATIONS[cleaned]) return US_STATE_ABBREVIATIONS[cleaned];
  return cleaned;
}

/**
 * Normalize a place string into a canonical comma-separated form.
 * Returns an empty string for null / empty / whitespace-only inputs.
 */
export function normalizePlace(value: string | null | undefined): string {
  if (!value) return '';

  const segments = value
    .split(',')
    .map(canonicalizeSegment)
    .filter(s => s.length > 0);

  return segments.join(', ');
}

/**
 * Whether two places describe the same location after normalization.
 * Empty strings on either side return false (use missing_local / missing_provider
 * upstream when one side is absent).
 */
export function placesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizePlace(a);
  const nb = normalizePlace(b);
  if (!na || !nb) return false;
  return na === nb;
}

/**
 * Whether one place is a more specific version of the other (one is a suffix
 * of the other when split on commas, e.g. "Dallas, Texas, USA" contains
 * "Texas, USA"). Used by getComparisonStatus to detect "detail-loss" matches
 * where one side is a less specific representation of the same place.
 */
export function placeContains(broader: string | null | undefined, narrower: string | null | undefined): boolean {
  const na = normalizePlace(broader);
  const nb = normalizePlace(narrower);
  if (!na || !nb) return false;
  if (na === nb) return true;

  const aSegs = na.split(', ');
  const bSegs = nb.split(', ');
  if (bSegs.length > aSegs.length) return false;

  // narrower's segments must appear as a contiguous tail of broader's segments
  const start = aSegs.length - bSegs.length;
  for (let i = 0; i < bSegs.length; i++) {
    if (aSegs[start + i] !== bSegs[i]) return false;
  }
  return true;
}
