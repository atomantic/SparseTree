/**
 * Fixture utilities for loading test data
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, '..', '__fixtures__');
const REAL_DATA_DIR = join(__dirname, '..', '..', 'data', 'person');

/**
 * Load a JSON fixture file
 */
export const loadFixture = <T = unknown>(relativePath: string): T => {
  const fullPath = join(FIXTURES_DIR, relativePath);
  if (!existsSync(fullPath)) {
    throw new Error(`Fixture not found: ${fullPath}`);
  }
  const content = readFileSync(fullPath, 'utf-8');
  return JSON.parse(content) as T;
};

/**
 * Load a real FamilySearch API response from the data/person directory
 * Useful for creating realistic test fixtures
 */
export const loadRealPersonData = <T = unknown>(personId: string): T => {
  const fullPath = join(REAL_DATA_DIR, `${personId}.json`);
  if (!existsSync(fullPath)) {
    throw new Error(`Person data not found: ${fullPath}`);
  }
  const content = readFileSync(fullPath, 'utf-8');
  return JSON.parse(content) as T;
};

/**
 * Load a database fixture (graph database JSON)
 */
export const loadDatabaseFixture = <T = unknown>(name: string): T => {
  return loadFixture<T>(`databases/${name}.json`);
};

/**
 * Load a person fixture for a specific provider
 */
export const loadPersonFixture = <T = unknown>(provider: string, filename: string): T => {
  return loadFixture<T>(`persons/${provider}/${filename}`);
};

/**
 * Create a minimal FamilySearch API response for testing
 */
export const createFamilySearchResponse = (overrides: Partial<{
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
}> = {}): Record<string, unknown> => {
  const {
    id = 'TEST-123',
    name = 'Test Person',
    gender = 'Male',
    birthDate = '1 January 1900',
    birthPlace = 'Test City, Test State',
    deathDate = '31 December 1980',
    deathPlace = 'Test City, Test State',
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
      id: 'birth-fact',
      type: 'http://gedcomx.org/Birth',
      date: { original: birthDate, formal: '+1900-01-01' },
      place: { original: birthPlace },
    },
  ];

  if (deathDate) {
    facts.push({
      id: 'death-fact',
      type: 'http://gedcomx.org/Death',
      date: { original: deathDate, formal: '+1980-12-31' },
      place: { original: deathPlace },
    });
  }

  if (occupation) {
    facts.push({
      id: 'occupation-fact',
      type: 'http://gedcomx.org/Occupation',
      value: occupation,
    });
  }

  if (bio) {
    facts.push({
      id: 'bio-fact',
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
    persons: [
      {
        id,
        living,
        gender: { type: genderType },
        names: [
          {
            type: 'http://gedcomx.org/BirthName',
            preferred: true,
            nameForms: [{ fullText: name }],
          },
        ],
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
      },
    ],
  };
};

/**
 * Create a test graph database with persons
 */
export const createTestGraph = (persons: Array<{
  id: string;
  name: string;
  children?: string[];
  parents?: string[];
}>): Record<string, { name: string; children: string[]; parents: string[] }> => {
  const graph: Record<string, { name: string; children: string[]; parents: string[] }> = {};

  for (const person of persons) {
    graph[person.id] = {
      name: person.name,
      children: person.children || [],
      parents: person.parents || [],
    };
  }

  return graph;
};

export default {
  loadFixture,
  loadRealPersonData,
  loadDatabaseFixture,
  loadPersonFixture,
  createFamilySearchResponse,
  createTestGraph,
};
