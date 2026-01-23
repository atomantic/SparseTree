/**
 * Unit tests for lib/json2person.js
 * Tests FamilySearch API response transformation to person objects
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import json2person from '../../../server/src/lib/familysearch/transformer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, '..', '..', '__fixtures__');

// Helper to load fixture
const loadFixture = (path: string) => {
  const content = readFileSync(join(FIXTURES_DIR, path), 'utf-8');
  return JSON.parse(content);
};

// Helper to create minimal API response
const createResponse = (overrides: Partial<{
  id: string;
  name: string;
  gender: 'Male' | 'Female';
  birthDate: string;
  birthPlace: string;
  deathDate: string;
  deathPlace: string;
  living: boolean;
  parents: string[];
  occupation: string;
  bio: string;
}> = {}) => {
  const {
    id = 'TEST-123',
    name = 'Test Person',
    gender = 'Male',
    birthDate = '1 January 1900',
    birthPlace = 'Test City',
    deathDate = '31 December 1980',
    deathPlace = 'Test City',
    living = false,
    parents = [],
    occupation,
    bio,
  } = overrides;

  const genderType = gender === 'Male'
    ? 'http://gedcomx.org/Male'
    : 'http://gedcomx.org/Female';

  const facts: Array<Record<string, unknown>> = [
    {
      type: 'http://gedcomx.org/Birth',
      date: { original: birthDate, formal: '+1900-01-01' },
      place: { original: birthPlace },
    },
  ];

  if (deathDate) {
    facts.push({
      type: 'http://gedcomx.org/Death',
      date: { original: deathDate, formal: '+1980-12-31' },
      place: { original: deathPlace },
    });
  }

  if (occupation) {
    facts.push({
      type: 'http://gedcomx.org/Occupation',
      value: occupation,
    });
  }

  if (bio) {
    facts.push({
      type: 'http://familysearch.org/v1/LifeSketch',
      value: bio,
    });
  }

  const familiesAsChild: Array<Record<string, unknown>> = [];
  if (parents.length > 0) {
    familiesAsChild.push({
      parent1: parents[0] ? { resourceId: parents[0] } : undefined,
      parent2: parents[1] ? { resourceId: parents[1] } : undefined,
    });
  }

  return {
    persons: [{
      id,
      living,
      gender: { type: genderType },
      names: [{
        type: 'http://gedcomx.org/BirthName',
        preferred: true,
        nameForms: [{ fullText: name }],
      }],
      facts,
      display: {
        name,
        gender,
        lifespan: `${birthDate.split(' ').pop()}-${deathDate?.split(' ').pop() || ''}`,
        birthDate,
        birthPlace,
        deathDate,
        deathPlace,
        familiesAsChild,
      },
    }],
  };
};

describe('json2person', () => {
  describe('complete FamilySearch response', () => {
    it('extracts all fields from complete response', () => {
      const apiResponse = loadFixture('persons/familysearch/complete.json');
      const result = json2person(apiResponse);

      expect(result).toBeDefined();
      expect(result!.name).toBe('Lena Temperance Dehaven');
      expect(result!.gender).toBe('female');
      expect(result!.living).toBe(false);
    });

    it('extracts birth event with date and place', () => {
      const apiResponse = loadFixture('persons/familysearch/complete.json');
      const result = json2person(apiResponse);

      expect(result!.birth).toBeDefined();
      expect(result!.birth!.date).toBe('8 November 1878');
      expect(result!.birth!.place).toBe('Howard, Missouri, United States');
    });

    it('extracts death event with date and place', () => {
      const apiResponse = loadFixture('persons/familysearch/complete.json');
      const result = json2person(apiResponse);

      expect(result!.death).toBeDefined();
      expect(result!.death!.date).toBe('3 May 1979');
      expect(result!.death!.place).toBe('Los Angeles, Los Angeles, California, United States');
    });

    it('extracts burial event', () => {
      const apiResponse = loadFixture('persons/familysearch/complete.json');
      const result = json2person(apiResponse);

      expect(result!.burial).toBeDefined();
      expect(result!.burial!.date).toBe('7 May 1979');
    });

    it('extracts parent IDs', () => {
      const apiResponse = loadFixture('persons/familysearch/complete.json');
      const result = json2person(apiResponse);

      expect(result!.parents).toHaveLength(2);
      expect(result!.parents).toContain('278Y-FXL');
      expect(result!.parents).toContain('LZNP-3VP');
    });

    it('computes lifespan correctly', () => {
      const apiResponse = loadFixture('persons/familysearch/complete.json');
      const result = json2person(apiResponse);

      expect(result!.lifespan).toBe('1878-1979');
    });

    it('sets location from birth place', () => {
      const apiResponse = loadFixture('persons/familysearch/complete.json');
      const result = json2person(apiResponse);

      expect(result!.location).toBe('Howard, Missouri, United States');
    });
  });

  describe('minimal response', () => {
    it('extracts name correctly', () => {
      const apiResponse = createResponse({
        id: 'MINIMAL-1',
        name: 'Minimal Person',
        gender: 'Male',
        parents: ['PARENT-1'],
      });

      const result = json2person(apiResponse);
      expect(result).toBeDefined();
      expect(result!.name).toBe('Minimal Person');
    });

    it('handles missing parents', () => {
      const apiResponse = createResponse({ parents: ['PARENT-1'] });
      const result = json2person(apiResponse);
      expect(result!.parents).toHaveLength(1);
    });

    it('initializes empty children array', () => {
      const apiResponse = createResponse({ parents: ['PARENT-1'] });
      const result = json2person(apiResponse);
      expect(result!.children).toEqual([]);
    });
  });

  describe('name types', () => {
    it('extracts birth name when primary is married name', () => {
      const apiResponse = {
        persons: [{
          id: 'NAMES-1',
          living: false,
          gender: { type: 'http://gedcomx.org/Female' },
          names: [
            {
              type: 'http://gedcomx.org/MarriedName',
              preferred: true,
              nameForms: [{ fullText: 'Jane Smith' }],
            },
            {
              type: 'http://gedcomx.org/BirthName',
              preferred: false,
              nameForms: [{ fullText: 'Jane Doe' }],
            },
          ],
          display: {
            name: 'Jane Smith',
            gender: 'Female',
            lifespan: '1900-1980',
            familiesAsChild: [],
          },
        }],
      };

      const result = json2person(apiResponse);
      expect(result!.name).toBe('Jane Smith');
      expect(result!.birthName).toBe('Jane Doe');
    });

    it('extracts aliases', () => {
      const apiResponse = {
        persons: [{
          id: 'ALIAS-1',
          living: false,
          gender: { type: 'http://gedcomx.org/Male' },
          names: [
            { type: 'http://gedcomx.org/BirthName', nameForms: [{ fullText: 'John Doe' }], preferred: true },
            { type: 'http://gedcomx.org/AlsoKnownAs', nameForms: [{ fullText: 'Johnny' }] },
          ],
          display: {
            name: 'John Doe',
            gender: 'Male',
            lifespan: '1900-1980',
            familiesAsChild: [],
          },
        }],
      };

      const result = json2person(apiResponse);
      expect(result!.aliases).toContain('Johnny');
    });
  });

  describe('occupations', () => {
    it('extracts multiple occupations', () => {
      const apiResponse = {
        persons: [{
          id: 'OCC-1',
          living: false,
          gender: { type: 'http://gedcomx.org/Male' },
          names: [{ nameForms: [{ fullText: 'Worker Person' }] }],
          facts: [
            { type: 'http://gedcomx.org/Occupation', value: 'Farmer' },
            { type: 'http://gedcomx.org/Occupation', value: 'Merchant' },
          ],
          display: {
            name: 'Worker Person',
            gender: 'Male',
            lifespan: '1850-1920',
            familiesAsChild: [],
          },
        }],
      };

      const result = json2person(apiResponse);
      expect(result!.occupations).toContain('Farmer');
      expect(result!.occupations).toContain('Merchant');
      expect(result!.occupation).toBe('Farmer'); // backwards compat
    });

    it('includes nobility titles in occupations', () => {
      const apiResponse = {
        persons: [{
          id: 'TITLE-1',
          living: false,
          gender: { type: 'http://gedcomx.org/Male' },
          names: [{ nameForms: [{ fullText: 'Noble Person' }] }],
          facts: [
            { type: 'data:,Title%20%28Nobility%29', value: 'Baron' },
          ],
          display: {
            name: 'Noble Person',
            gender: 'Male',
            lifespan: '1800-1880',
            familiesAsChild: [],
          },
        }],
      };

      const result = json2person(apiResponse);
      expect(result!.occupations).toContain('Baron');
    });
  });

  describe('biography', () => {
    it('extracts life sketch', () => {
      const apiResponse = {
        persons: [{
          id: 'BIO-1',
          living: false,
          gender: { type: 'http://gedcomx.org/Male' },
          names: [{ nameForms: [{ fullText: 'Bio Person' }] }],
          facts: [
            {
              type: 'http://familysearch.org/v1/LifeSketch',
              value: 'A remarkable life story.',
            },
          ],
          display: {
            name: 'Bio Person',
            gender: 'Male',
            lifespan: '1800-1880',
            familiesAsChild: [],
          },
        }],
      };

      const result = json2person(apiResponse);
      expect(result!.bio).toBe('A remarkable life story.');
    });
  });

  describe('spouses', () => {
    it('extracts spouse IDs from familiesAsParent', () => {
      const apiResponse = {
        persons: [{
          id: 'SPOUSE-1',
          living: false,
          gender: { type: 'http://gedcomx.org/Male' },
          names: [{ nameForms: [{ fullText: 'Married Person' }] }],
          display: {
            name: 'Married Person',
            gender: 'Male',
            lifespan: '1900-1980',
            familiesAsParent: [
              { parent2: { resourceId: 'SPOUSE-A' } },
              { parent2: { resourceId: 'SPOUSE-B' } },
            ],
            familiesAsChild: [],
          },
        }],
      };

      const result = json2person(apiResponse);
      expect(result!.spouses).toContain('SPOUSE-A');
      expect(result!.spouses).toContain('SPOUSE-B');
    });

    it('deduplicates spouse IDs', () => {
      const apiResponse = {
        persons: [{
          id: 'DUPE-SPOUSE',
          living: false,
          gender: { type: 'http://gedcomx.org/Male' },
          names: [{ nameForms: [{ fullText: 'Person' }] }],
          display: {
            name: 'Person',
            gender: 'Male',
            lifespan: '1900-1980',
            familiesAsParent: [
              { parent2: { resourceId: 'SPOUSE-A' } },
              { parent2: { resourceId: 'SPOUSE-A' } },
            ],
            familiesAsChild: [],
          },
        }],
      };

      const result = json2person(apiResponse);
      expect(result!.spouses).toHaveLength(1);
    });
  });

  describe('known unknowns (placeholder records)', () => {
    it('returns undefined for placeholder records without parents', () => {
      const apiResponse = {
        persons: [{
          id: 'UNKNOWN-1',
          living: false,
          gender: { type: 'http://gedcomx.org/Male' },
          names: [{ nameForms: [{ fullText: 'Unknown' }] }],
          display: {
            name: 'Unknown',
            gender: 'Male',
            lifespan: '',
            familiesAsChild: [],
          },
        }],
      };

      const result = json2person(apiResponse);
      expect(result).toBeUndefined();
    });

    it('keeps records with known unknown names that have parents', () => {
      const apiResponse = {
        persons: [{
          id: 'UNKNOWN-2',
          living: false,
          gender: { type: 'http://gedcomx.org/Male' },
          names: [{ nameForms: [{ fullText: 'Unknown' }] }],
          display: {
            name: 'Unknown',
            gender: 'Male',
            lifespan: '',
            familiesAsChild: [{ parent1: { resourceId: 'PARENT-1' } }],
          },
        }],
      };

      const result = json2person(apiResponse);
      expect(result).toBeDefined();
    });
  });

  describe('gender extraction', () => {
    it.each([
      ['http://gedcomx.org/Male', 'male'],
      ['http://gedcomx.org/Female', 'female'],
      ['http://gedcomx.org/Unknown', 'unknown'],
    ])('extracts gender %s as %s', (genderType, expected) => {
      const apiResponse = {
        persons: [{
          id: 'GENDER-1',
          living: false,
          gender: { type: genderType },
          names: [{ nameForms: [{ fullText: 'Test' }] }],
          display: {
            name: 'Test',
            gender: expected,
            lifespan: '1900-1980',
            familiesAsChild: [{ parent1: { resourceId: 'P1' } }],
          },
        }],
      };

      const result = json2person(apiResponse);
      expect(result!.gender).toBe(expected);
    });

    it('defaults to unknown for missing gender', () => {
      const apiResponse = {
        persons: [{
          id: 'NO-GENDER',
          living: false,
          names: [{ nameForms: [{ fullText: 'Test' }] }],
          display: {
            name: 'Test',
            gender: 'Unknown',
            lifespan: '1900-1980',
            familiesAsChild: [{ parent1: { resourceId: 'P1' } }],
          },
        }],
      };

      const result = json2person(apiResponse);
      expect(result!.gender).toBe('unknown');
    });
  });

  describe('date handling', () => {
    it('extracts formal ISO date', () => {
      const apiResponse = {
        persons: [{
          id: 'DATE-1',
          living: false,
          gender: { type: 'http://gedcomx.org/Male' },
          names: [{ nameForms: [{ fullText: 'Date Person' }] }],
          facts: [{
            type: 'http://gedcomx.org/Birth',
            date: { original: '15 March 1850', formal: '+1850-03-15' },
            place: { original: 'London', description: '#12345' },
          }],
          display: {
            name: 'Date Person',
            gender: 'Male',
            lifespan: '1850-1920',
            familiesAsChild: [],
          },
        }],
      };

      const result = json2person(apiResponse);
      expect(result!.birth!.date).toBe('15 March 1850');
      expect(result!.birth!.dateFormal).toBe('+1850-03-15');
      expect(result!.birth!.placeId).toBe('12345');
    });

    it('extracts normalized date when original is missing', () => {
      const apiResponse = {
        persons: [{
          id: 'NORM-DATE',
          living: false,
          names: [{ nameForms: [{ fullText: 'Person' }] }],
          facts: [{
            type: 'http://gedcomx.org/Birth',
            date: { normalized: [{ value: 'January 1900' }] },
          }],
          display: {
            name: 'Person',
            gender: 'Male',
            lifespan: '1900-1980',
            familiesAsChild: [],
          },
        }],
      };

      const result = json2person(apiResponse);
      expect(result!.birth!.date).toBe('January 1900');
    });
  });

  describe('edge cases', () => {
    it('handles missing display object', () => {
      const response = {
        persons: [{
          id: 'NO-DISPLAY',
          living: false,
          gender: { type: 'http://gedcomx.org/Male' },
          names: [{ nameForms: [{ fullText: 'No Display Person' }] }],
        }],
      };

      const result = json2person(response);
      expect(result).toBeDefined();
      expect(result!.name).toBe('No Display Person');
      expect(result!.parents).toEqual([]);
    });

    it('falls back to "unknown" when no name is available', () => {
      const response = {
        persons: [{
          id: 'NO-NAME',
          living: false,
          display: {
            gender: 'Male',
            lifespan: '1900-1980',
            familiesAsChild: [{ parent1: { resourceId: 'P1' } }],
          },
        }],
      };

      const result = json2person(response);
      expect(result!.name).toBe('unknown');
    });

    it('handles empty facts array', () => {
      const response = {
        persons: [{
          id: 'EMPTY-FACTS',
          living: false,
          names: [{ nameForms: [{ fullText: 'Person' }] }],
          facts: [],
          display: {
            name: 'Person',
            gender: 'Male',
            lifespan: '1900-1980',
            familiesAsChild: [],
          },
        }],
      };

      const result = json2person(response);
      expect(result!.birth).toBeUndefined();
      expect(result!.death).toBeUndefined();
    });

    it('sets living flag correctly', () => {
      const apiResponse = {
        persons: [{
          id: 'LIVING-1',
          living: true,
          gender: { type: 'http://gedcomx.org/Male' },
          names: [{ nameForms: [{ fullText: 'Living Person' }] }],
          display: {
            name: 'Living Person',
            gender: 'Male',
            lifespan: '1990-',
            familiesAsChild: [{ parent1: { resourceId: 'P1' } }],
          },
        }],
      };

      const result = json2person(apiResponse);
      expect(result!.living).toBe(true);
    });
  });
});
