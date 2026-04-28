/**
 * Unit tests for server/src/utils/normalizePlace.ts
 *
 * Place normalization is used by the multi-platform comparison service to
 * avoid flagging the same physical location as a "difference" just because
 * one provider writes "USA" and another writes "United States" (PLAN.md
 * Phase 19.4).
 */

import { describe, it, expect } from 'vitest';
import {
  normalizePlace,
  placesMatch,
  placeContains,
} from '../../../server/src/utils/normalizePlace.js';

describe('normalizePlace', () => {
  it('returns empty string for null/undefined/empty inputs', () => {
    expect(normalizePlace(null)).toBe('');
    expect(normalizePlace(undefined)).toBe('');
    expect(normalizePlace('')).toBe('');
    expect(normalizePlace('   ')).toBe('');
  });

  it('lowercases and trims segments', () => {
    expect(normalizePlace('Paris, France')).toBe('paris, france');
    expect(normalizePlace('  Paris  ,  France  ')).toBe('paris, france');
  });

  it('collapses internal whitespace', () => {
    expect(normalizePlace('New   York,   New   York')).toBe('new york, new york');
  });

  it('strips trailing periods on segments', () => {
    expect(normalizePlace('Paris, France.')).toBe('paris, france');
    expect(normalizePlace('U.S.A.')).toBe('united states');
  });

  it('drops empty segments from leading/trailing/internal commas', () => {
    expect(normalizePlace(',Paris,, France,')).toBe('paris, france');
  });

  it('canonicalizes USA aliases to "united states"', () => {
    expect(normalizePlace('Dallas, Texas, USA')).toBe('dallas, texas, united states');
    expect(normalizePlace('Dallas, Texas, United States')).toBe('dallas, texas, united states');
    expect(normalizePlace('Dallas, Texas, United States of America')).toBe('dallas, texas, united states');
    expect(normalizePlace('Dallas, Texas, U.S.A.')).toBe('dallas, texas, united states');
    expect(normalizePlace('Dallas, Texas, U.S.')).toBe('dallas, texas, united states');
  });

  it('canonicalizes United Kingdom aliases', () => {
    expect(normalizePlace('London, England, UK')).toBe('london, england, united kingdom');
    expect(normalizePlace('London, England, U.K.')).toBe('london, england, united kingdom');
    expect(normalizePlace('London, England, Great Britain')).toBe('london, england, united kingdom');
  });

  it('expands US state abbreviations', () => {
    expect(normalizePlace('Dallas, TX, USA')).toBe('dallas, texas, united states');
    expect(normalizePlace('Boston, MA, USA')).toBe('boston, massachusetts, united states');
    expect(normalizePlace('Brooklyn, NY')).toBe('brooklyn, new york');
  });

  it('preserves segment order', () => {
    // We do not reorder segments — "Texas, Dallas, USA" would be a typo, not the same place
    const a = normalizePlace('Dallas, Texas, USA');
    const b = normalizePlace('Texas, Dallas, USA');
    expect(a).not.toBe(b);
  });

  it('is idempotent', () => {
    const inputs = [
      'Dallas, Texas, USA',
      'London, England, UK',
      '   Paris , France .',
      'Brooklyn, NY',
      '',
      null,
    ];
    for (const input of inputs) {
      const once = normalizePlace(input);
      const twice = normalizePlace(once);
      expect(twice).toBe(once);
    }
  });

  it('does not collapse non-alias names that happen to share a prefix', () => {
    // "ussr" is an alias for soviet union, but "ussr-something" should not be collapsed
    expect(normalizePlace('USSR-Town')).toBe('ussr-town');
  });
});

describe('placesMatch', () => {
  it('matches alias variants of the same place', () => {
    expect(placesMatch('Dallas, Texas, USA', 'Dallas, Texas, United States')).toBe(true);
    expect(placesMatch('Dallas, TX, USA', 'Dallas, Texas, United States')).toBe(true);
    expect(placesMatch('London, England, UK', 'London, England, United Kingdom')).toBe(true);
  });

  it('treats null/empty side as no match', () => {
    expect(placesMatch(null, 'Paris, France')).toBe(false);
    expect(placesMatch('Paris, France', '')).toBe(false);
  });

  it('rejects different cities', () => {
    expect(placesMatch('Dallas, Texas, USA', 'Houston, Texas, USA')).toBe(false);
  });

  it('rejects different countries', () => {
    expect(placesMatch('Paris, France', 'Paris, Texas, USA')).toBe(false);
  });

  it('does not consider less-specific places equal', () => {
    // "Texas, USA" is not the same place as "Dallas, Texas, USA" — placeContains
    // covers the suffix relationship instead. placesMatch is strict equality.
    expect(placesMatch('Texas, USA', 'Dallas, Texas, USA')).toBe(false);
  });
});

describe('placeContains', () => {
  it('detects suffix relationships across alias variants', () => {
    expect(placeContains('Dallas, Texas, USA', 'Texas, United States')).toBe(true);
    expect(placeContains('Dallas, TX, USA', 'United States')).toBe(true);
  });

  it('returns true for exact-match inputs', () => {
    expect(placeContains('Paris, France', 'Paris, France')).toBe(true);
  });

  it('rejects non-suffix containment to avoid false positives', () => {
    // "Texas" is a substring of "Texarkana" but is not a trailing comma
    // segment, so placeContains must not match.
    expect(placeContains('Texarkana', 'Texas')).toBe(false);
  });

  it('rejects when narrower side has different segments', () => {
    expect(placeContains('Dallas, Texas, USA', 'Houston, Texas, USA')).toBe(false);
  });

  it('handles empty and null inputs', () => {
    expect(placeContains(null, 'Texas')).toBe(false);
    expect(placeContains('Dallas, Texas', null)).toBe(false);
    expect(placeContains('', '')).toBe(false);
  });

  it('rejects when narrower has more segments than broader', () => {
    expect(placeContains('Texas, USA', 'Dallas, Texas, USA')).toBe(false);
  });
});
