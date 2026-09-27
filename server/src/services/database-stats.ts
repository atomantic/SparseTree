import type { Database, OnThisDayEvent } from '@fsf/shared';
import { parseYear } from '../utils/parseYear.js';

export interface TreeStats {
  totalPersons: number;
  gender: { male: number; female: number; unknown: number };
  completeness: { hasBirthDate: number; hasBirthPlace: number; hasDeathDate: number; hasDeathPlace: number; hasPhoto: number };
  providers: Record<string, number>;
  favorites: number;
  generations: { generation: number; count: number }[];
  centuries: { century: number; count: number }[];
  surnames: { surname: string; count: number }[];
  lifespans: {
    overall: { avgAge: number; count: number } | null;
    byGender: { gender: string; avgAge: number; count: number }[];
    byCentury: { century: number; avgAge: number; count: number }[];
  };
  birthPlaces: { place: string; count: number }[];
  birthCountries: { country: string; count: number }[];
  occupations: { occupation: string; count: number }[];
}

const increment = <T>(counts: Map<T, number>, key: T) => counts.set(key, (counts.get(key) ?? 0) + 1);
const top = <T>(counts: Map<T, number>, limit: number) => [...counts].sort((a, b) => b[1] - a[1]).slice(0, limit);
const average = (ages: number[]) => ({ avgAge: Math.round(ages.reduce((a, b) => a + b, 0) / ages.length * 10) / 10, count: ages.length });

/** JSON-backed statistics use only facts available in the source graph. */
export function getJsonTreeStats(db: Database, rootId: string): TreeStats {
  const gender = { male: 0, female: 0, unknown: 0 };
  const completeness = { hasBirthDate: 0, hasBirthPlace: 0, hasDeathDate: 0, hasDeathPlace: 0, hasPhoto: 0 };
  const centuries = new Map<number, number>();
  const surnames = new Map<string, number>();
  const places = new Map<string, number>();
  const countries = new Map<string, number>();
  const occupations = new Map<string, number>();
  const ages: number[] = [];
  const genderAges = new Map<string, number[]>();
  const centuryAges = new Map<number, number[]>();
  for (const person of Object.values(db)) {
    const key = person.gender === 'male' || person.gender === 'female' ? person.gender : 'unknown';
    gender[key]++;
    if (person.birth?.date) completeness.hasBirthDate++;
    if (person.birth?.place) completeness.hasBirthPlace++;
    if (!person.living && person.death?.date) completeness.hasDeathDate++;
    if (!person.living && person.death?.place) completeness.hasDeathPlace++;
    const year = parseYear(person.birth?.dateFormal ?? person.birth?.date);
    const deathYear = parseYear(person.death?.dateFormal ?? person.death?.date);
    const century = year == null ? null : Math.trunc(year / 100);
    if (century !== null) increment(centuries, century);
    const space = person.name.indexOf(' ');
    const surname = space < 0 ? '' : person.name.slice(space + 1).trim();
    if (surname) increment(surnames, surname);
    if (person.birth?.place) {
      increment(places, person.birth.place);
      const country = person.birth.place.split(',').at(-1)!.trim();
      if (country) increment(countries, country);
    }
    for (const occupation of new Set(person.occupations ?? (person.occupation ? [person.occupation] : []))) {
      if (occupation) increment(occupations, occupation);
    }
    if (year != null && deathYear != null && deathYear - year >= 0 && deathYear - year <= 120) {
      const age = deathYear - year;
      ages.push(age);
      const byGender = genderAges.get(key) ?? [];
      byGender.push(age);
      genderAges.set(key, byGender);
      const byCentury = centuryAges.get(century!) ?? [];
      byCentury.push(age);
      centuryAges.set(century!, byCentury);
    }
  }
  const seen = new Set<string>();
  const generations = new Map<number, number>();
  const queue = [{ id: rootId, generation: 0 }];
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const { id, generation } = queue[cursor];
    if (!db[id] || seen.has(id)) continue;
    seen.add(id);
    increment(generations, generation);
    for (const parent of db[id].parents ?? []) if (parent) queue.push({ id: parent, generation: generation + 1 });
  }
  return {
    totalPersons: Object.keys(db).length, gender, completeness, providers: {}, favorites: 0,
    generations: [...generations].map(([generation, count]) => ({ generation, count })),
    centuries: [...centuries].sort((a, b) => a[0] - b[0]).map(([century, count]) => ({ century, count })),
    surnames: top(surnames, 30).filter(([, count]) => count > 1).map(([surname, count]) => ({ surname, count })),
    lifespans: {
      overall: ages.length ? average(ages) : null,
      byGender: [...genderAges].sort(([a], [b]) => a.localeCompare(b)).map(([gender, values]) => ({ gender, ...average(values) })),
      byCentury: [...centuryAges].sort(([a], [b]) => a - b).map(([century, values]) => ({ century, ...average(values) })),
    },
    birthPlaces: top(places, 30).map(([place, count]) => ({ place, count })),
    birthCountries: top(countries, 20).map(([country, count]) => ({ country, count })),
    occupations: top(occupations, 30).map(([occupation, count]) => ({ occupation, count })),
  };
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

export function matchesAnniversary(date: string, month: number, day: number): boolean {
  const match = date.match(/(\d{1,2})\s+([A-Za-z]+)\s+/);
  return Boolean(match && Number(match[1]) === day && MONTHS.indexOf(match[2].slice(0, 3).toLowerCase()) + 1 === month);
}

export function sortAnniversaries(events: OnThisDayEvent[]): OnThisDayEvent[] {
  return events.sort((a, b) => a.eventType === b.eventType ? (a.year ?? 0) - (b.year ?? 0) : a.eventType === 'birth' ? -1 : 1);
}
