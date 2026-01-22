/**
 * Convert FamilySearch person JSON payload to richer db/graph person format
 */

import config from "../config.js";

// GEDCOMX type URIs
const TYPES = {
  BIRTH: "http://gedcomx.org/Birth",
  DEATH: "http://gedcomx.org/Death",
  BURIAL: "http://gedcomx.org/Burial",
  OCCUPATION: "http://gedcomx.org/Occupation",
  LIFE_SKETCH: "http://familysearch.org/v1/LifeSketch",
  ALSO_KNOWN_AS: "http://gedcomx.org/AlsoKnownAs",
  BIRTH_NAME: "http://gedcomx.org/BirthName",
  MARRIED_NAME: "http://gedcomx.org/MarriedName",
  MALE: "http://gedcomx.org/Male",
  FEMALE: "http://gedcomx.org/Female",
};

// Title-related fact types (nobility, occupation equivalents)
const TITLE_TYPES = [
  "data:,Title%20%28Nobility%29",
  "http://gedcomx.org/Title",
];

/**
 * Extract names categorized by type
 * Returns { birthName, marriedNames, aliases, alternateNames }
 *
 * birthName: Only set if primary name is NOT a birth name (e.g., they use married name)
 * marriedNames: All married names (excluding the primary if it's a married name)
 * aliases: All "also known as" names
 * alternateNames: All non-primary names (for backwards compat)
 */
const extractNamesByType = (names, primaryName) => {
  const result = {
    birthName: undefined,
    marriedNames: [],
    aliases: [],
    alternateNames: [], // All non-preferred names for backwards compat
  };

  if (!names || !Array.isArray(names)) return result;

  // First pass: determine if primary name is a birth name
  let primaryIsBirthName = false;
  let foundBirthName = null;

  for (const nameObj of names) {
    const fullText = nameObj?.nameForms?.[0]?.fullText;
    if (!fullText) continue;

    if (fullText === primaryName && nameObj.type === TYPES.BIRTH_NAME) {
      primaryIsBirthName = true;
    }
    // Track first non-primary birth name we find
    if (nameObj.type === TYPES.BIRTH_NAME && fullText !== primaryName && !foundBirthName) {
      foundBirthName = fullText;
    }
  }

  // Second pass: categorize all names
  for (const nameObj of names) {
    const fullText = nameObj?.nameForms?.[0]?.fullText;
    if (!fullText) continue;

    const isPrimary = fullText === primaryName;

    if (nameObj.type === TYPES.BIRTH_NAME) {
      if (!isPrimary) {
        // Only set birthName if primary is NOT a birth name
        // This means the person uses their married name or alias as display name
        if (!primaryIsBirthName && fullText === foundBirthName) {
          result.birthName = fullText;
        }
        result.alternateNames.push(fullText);
      }
    } else if (nameObj.type === TYPES.MARRIED_NAME) {
      if (!isPrimary) {
        result.marriedNames.push(fullText);
        result.alternateNames.push(fullText);
      }
    } else if (nameObj.type === TYPES.ALSO_KNOWN_AS) {
      result.aliases.push(fullText);
      if (!isPrimary) {
        result.alternateNames.push(fullText);
      }
    } else if (!isPrimary) {
      // Other non-primary names go to alternateNames
      result.alternateNames.push(fullText);
    }
  }

  // Dedupe all arrays
  result.marriedNames = [...new Set(result.marriedNames)];
  result.aliases = [...new Set(result.aliases)];
  result.alternateNames = [...new Set(result.alternateNames)];

  return result;
};

/**
 * Extract all alternate names from names array (backwards compat wrapper)
 */
const extractAlternateNames = (names, primaryName) => {
  return extractNamesByType(names, primaryName).alternateNames;
};

/**
 * Extract gender from gender object
 */
const extractGender = (genderObj) => {
  if (!genderObj?.type) return "unknown";
  if (genderObj.type === TYPES.MALE) return "male";
  if (genderObj.type === TYPES.FEMALE) return "female";
  return "unknown";
};

/**
 * Find a fact by type
 */
const findFact = (facts, type) => {
  if (!facts || !Array.isArray(facts)) return null;
  return facts.find((f) => f.type === type);
};

/**
 * Find all facts matching given types
 */
const findAllFacts = (facts, types) => {
  if (!facts || !Array.isArray(facts)) return [];
  const typeSet = Array.isArray(types) ? types : [types];
  return facts.filter((f) => typeSet.includes(f.type));
};

/**
 * Extract vital event (birth/death/burial) data
 */
const extractVitalEvent = (fact) => {
  if (!fact) return undefined;

  const event = {};

  // Date extraction
  if (fact.date) {
    event.date = fact.date.original || fact.date.normalized?.[0]?.value;
    if (fact.date.formal) {
      event.dateFormal = fact.date.formal;
    }
  }

  // Place extraction
  if (fact.place) {
    event.place = fact.place.original || fact.place.normalized?.[0]?.value;
    // Extract place ID from description (format: "#12345")
    if (fact.place.description?.startsWith("#")) {
      event.placeId = fact.place.description.slice(1);
    }
  }

  // Only return if we have some data
  return Object.keys(event).length > 0 ? event : undefined;
};

/**
 * Extract all occupations and titles
 */
const extractOccupations = (facts) => {
  const occupations = [];

  // Standard occupations
  const occFacts = findAllFacts(facts, TYPES.OCCUPATION);
  for (const fact of occFacts) {
    if (fact.value) occupations.push(fact.value);
  }

  // Titles (nobility, etc.)
  const titleFacts = findAllFacts(facts, TITLE_TYPES);
  for (const fact of titleFacts) {
    if (fact.value) occupations.push(fact.value);
  }

  return [...new Set(occupations)]; // dedupe
};

/**
 * Extract spouse IDs from familiesAsParent
 */
const extractSpouses = (display) => {
  if (!display?.familiesAsParent) return [];

  const spouses = [];
  for (const family of display.familiesAsParent) {
    // parent2 is the spouse in most cases
    const spouseId = family?.parent2?.resourceId;
    if (spouseId) spouses.push(spouseId);
  }
  return [...new Set(spouses)]; // dedupe
};

/**
 * Get the most recent modification timestamp
 */
const extractLastModified = (selfRef) => {
  let latest = 0;

  // Check facts for latest modification
  if (selfRef?.facts) {
    for (const fact of selfRef.facts) {
      const mod = fact?.attribution?.modified;
      if (mod && mod > latest) latest = mod;
    }
  }

  // Check names for latest modification
  if (selfRef?.names) {
    for (const name of selfRef.names) {
      const mod = name?.attribution?.modified;
      if (mod && mod > latest) latest = mod;
    }
  }

  return latest > 0 ? new Date(latest).toISOString() : undefined;
};

/**
 * Compute lifespan string from birth and death events
 */
const computeLifespan = (birth, death, displayLifespan) => {
  // Prefer display.lifespan if available
  if (displayLifespan) return displayLifespan;

  const birthDate = birth?.date || "";
  const deathDate = death?.date || "";

  if (birthDate || deathDate) {
    return `${birthDate}-${deathDate}`;
  }
  return "";
};

/**
 * Convert FamilySearch person JSON to our enhanced person format
 */
export const json2person = (json) => {
  const selfRef = json.persons[0];
  const display = selfRef?.display;

  // Extract parent IDs
  const parentData = (display?.familiesAsChild || [{}])[0];
  const parents = [];
  const parent1 = parentData?.parent1?.resourceId;
  const parent2 = parentData?.parent2?.resourceId;
  if (parent1) parents.push(parent1);
  if (parent2) parents.push(parent2);

  // Primary name (from display or first name form)
  const name = display?.name || selfRef?.names?.[0]?.nameForms?.[0]?.fullText || "unknown";

  // Extract names categorized by type
  const nameData = extractNamesByType(selfRef?.names, name);
  const { birthName, marriedNames, aliases, alternateNames } = nameData;

  // Gender
  const gender = extractGender(selfRef?.gender);

  // Living flag
  const living = selfRef?.living ?? false;

  // Vital events
  const facts = selfRef?.facts || [];
  const birth = extractVitalEvent(findFact(facts, TYPES.BIRTH));
  const death = extractVitalEvent(findFact(facts, TYPES.DEATH));
  const burial = extractVitalEvent(findFact(facts, TYPES.BURIAL));

  // Occupations (all)
  const occupations = extractOccupations(facts);

  // Biography/Life Sketch
  const bioFact = findFact(facts, TYPES.LIFE_SKETCH);
  const bio = bioFact?.value;

  // Spouses
  const spouses = extractSpouses(display);

  // Last modified timestamp
  const lastModified = extractLastModified(selfRef);

  // Computed compatibility fields
  const lifespan = computeLifespan(birth, death, display?.lifespan);
  const location = birth?.place || death?.place || display?.birthPlace || display?.deathPlace;
  const occupation = occupations[0]; // First occupation for backwards compat

  // Skip saving placeholder/unknown termination points
  if (!parent1 && !parent2 && config.knownUnknowns.includes(name.toLowerCase())) {
    return;
  }

  return {
    // Identity
    name,
    birthName,
    marriedNames: marriedNames.length > 0 ? marriedNames : undefined,
    aliases: aliases.length > 0 ? aliases : undefined,
    alternateNames: alternateNames.length > 0 ? alternateNames : undefined,
    gender,
    living,

    // Vital Events
    birth,
    death,
    burial,

    // Life Details
    occupations: occupations.length > 0 ? occupations : undefined,
    bio,

    // Relationships
    parents,
    spouses: spouses.length > 0 ? spouses : undefined,
    children: [], // Populated later during db save

    // Metadata
    lastModified,

    // Compatibility fields
    lifespan,
    location,
    occupation,
  };
};

export default json2person;
