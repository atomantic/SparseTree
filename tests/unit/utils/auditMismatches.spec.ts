import { describe, expect, it } from 'vitest';
import { cachedProviderVitalValues, findCrossSourceMismatches } from '../../../server/src/utils/auditMismatches.js';
import { providerCacheVitalValues } from '../../../server/src/utils/auditProviderVitals.js';
import { placeContains, placesMatch } from '../../../server/src/utils/normalizePlace.js';

describe('findCrossSourceMismatches', () => {
  it('turns cached scraped provider vitals into source-labelled audit values', () => {
    expect(cachedProviderVitalValues({
      provider: 'ancestry',
      scrapedData: {
        birth: { date: 'about 1875', place: 'Houston, Texas' },
        death: { date: '1930' },
      },
    })).toEqual([
      { eventType: 'birth', value: 1875, source: 'ancestry' },
      { eventType: 'birth', value: 'Houston, Texas', source: 'ancestry' },
      { eventType: 'death', value: 1930, source: 'ancestry' },
    ]);
  });

  it('reads raw FamilySearch refresh caches before comparing providers', () => {
    expect(providerCacheVitalValues('familysearch', {
      persons: [{
        display: { name: 'Ada Example' },
        facts: [{
          type: 'http://gedcomx.org/Birth',
          date: { original: '1874' },
          place: { original: 'Dallas, Texas' },
        }],
      }],
    })).toEqual([
      { eventType: 'birth', value: 1874, source: 'familysearch' },
      { eventType: 'birth', value: 'Dallas, Texas', source: 'familysearch' },
    ]);
  });

  it('reports a disagreement between two provider values', () => {
    const mismatches = findCrossSourceMismatches([
      { eventType: 'birth', value: 1874, source: 'familysearch' },
      { eventType: 'birth', value: 1875, source: 'ancestry' },
    ], (a, b) => a === b);

    expect(mismatches).toEqual([{
      eventType: 'birth',
      details: 'ancestry: 1875, familysearch: 1874',
    }]);
  });

  it('does not report values that only disagree within one source', () => {
    const mismatches = findCrossSourceMismatches([
      { eventType: 'birth', value: 1874, source: null },
      { eventType: 'birth', value: 1875, source: null },
    ], (a, b) => a === b);

    expect(mismatches).toEqual([]);
  });

  it('suppresses normalized aliases and detail-only place differences', () => {
    const samePlace = (a: string | number, b: string | number) => {
      const left = String(a);
      const right = String(b);
      return placesMatch(left, right) || placeContains(left, right) || placeContains(right, left);
    };

    const mismatches = findCrossSourceMismatches([
      { eventType: 'birth', value: 'Dallas, TX, USA', source: 'familysearch' },
      { eventType: 'birth', value: 'Dallas, Texas, United States', source: 'ancestry' },
      { eventType: 'death', value: 'Texas, USA', source: 'familysearch' },
      { eventType: 'death', value: 'Austin, Texas, United States', source: 'ancestry' },
    ], samePlace);

    expect(mismatches).toEqual([]);
  });

  it('reports genuinely different places from different sources', () => {
    const mismatches = findCrossSourceMismatches([
      { eventType: 'birth', value: 'Dallas, Texas, USA', source: 'familysearch' },
      { eventType: 'birth', value: 'Houston, Texas, USA', source: 'ancestry' },
    ], (a, b) => placesMatch(String(a), String(b)));

    expect(mismatches).toEqual([{
      eventType: 'birth',
      details: 'ancestry: Houston, Texas, USA, familysearch: Dallas, Texas, USA',
    }]);
  });
});
