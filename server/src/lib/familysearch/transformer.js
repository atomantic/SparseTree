/**
 * Convert FamilySearch person JSON payload to richer db/graph person format
 *
 * Extracts all GEDCOM-X and FamilySearch-specific fact types for comprehensive
 * storage in SQLite life_event table.
 */

import { config } from '../config.js';

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
  "data:,TitleOfNobility",
  "http://gedcomx.org/Title",
];

// Fact types to extract (besides the special-cased ones above)
// These get stored in the life_event table
const LIFE_EVENT_TYPES = [
  // Religious events
  "http://gedcomx.org/Christening",
  "http://gedcomx.org/Baptism",
  "http://gedcomx.org/Confirmation",
  "http://gedcomx.org/BarMitzvah",
  "http://gedcomx.org/BatMitzvah",
  "http://gedcomx.org/Ordination",
  "http://gedcomx.org/Religion",

  // Marriage & Family
  "http://gedcomx.org/Marriage",
  "http://gedcomx.org/MarriageBanns",
  "http://gedcomx.org/MarriageContract",
  "http://gedcomx.org/MarriageLicense",
  "http://gedcomx.org/Divorce",
  "http://gedcomx.org/Annulment",
  "http://gedcomx.org/Adoption",

  // Occupation & Education
  "http://gedcomx.org/Education",
  "http://gedcomx.org/Retirement",
  "http://gedcomx.org/Apprenticeship",

  // Military
  "http://gedcomx.org/MilitaryService",
  "http://gedcomx.org/MilitaryAward",
  "http://gedcomx.org/MilitaryDischarge",

  // Residence & Migration
  "http://gedcomx.org/Residence",
  "http://gedcomx.org/Immigration",
  "http://gedcomx.org/Emigration",
  "http://gedcomx.org/Naturalization",

  // Legal & Records
  "http://gedcomx.org/Census",
  "http://gedcomx.org/Will",
  "http://gedcomx.org/Probate",
  "http://gedcomx.org/LandTransaction",
  "http://gedcomx.org/NationalId",

  // Personal attributes
  "http://gedcomx.org/PhysicalDescription",
  "http://gedcomx.org/Ethnicity",
  "http://gedcomx.org/Nationality",
  "http://gedcomx.org/Caste",
  "http://gedcomx.org/MedicalCondition",

  // FamilySearch custom types (data: URI scheme)
  "data:,TitleOfNobility",
  "data:,HereditaryTitle",
  "data:,CauseOfDeath",
  "data:,TribeName",
  "data:,Clan",
  "data:,Affiliation",
  "data:,Destination",
  "data:,Origin",
  "data:,PortOfDeparture",
  "data:,PortOfArrival",
  "data:,Vessel",
  "data:,Property",
  "data:,Stillborn",
  "data:,DiedBeforeEight",
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
 * Parse a date string into year/month/day components
 * Handles BC dates (negative years), "abt", "bef", "aft" prefixes
 */
const parseDateComponents = (dateStr) => {
  if (!dateStr) return {};

  const result = {};

  // Handle formal GEDCOM-X dates like "+1847", "-0500"
  if (dateStr.startsWith("+") || dateStr.startsWith("-")) {
    const year = parseInt(dateStr, 10);
    if (!isNaN(year)) result.year = year;
    return result;
  }

  // Handle "BC" notation
  const bcMatch = dateStr.match(/(\d+)\s*BC/i);
  if (bcMatch) {
    result.year = -parseInt(bcMatch[1], 10);
    return result;
  }

  // Try to extract year from various formats
  const yearMatch = dateStr.match(/\b(\d{4})\b/);
  if (yearMatch) {
    result.year = parseInt(yearMatch[1], 10);
  }

  // Try to extract month names
  const monthNames = {
    jan: 1, january: 1,
    feb: 2, february: 2,
    mar: 3, march: 3,
    apr: 4, april: 4,
    may: 5,
    jun: 6, june: 6,
    jul: 7, july: 7,
    aug: 8, august: 8,
    sep: 9, sept: 9, september: 9,
    oct: 10, october: 10,
    nov: 11, november: 11,
    dec: 12, december: 12,
  };

  const monthMatch = dateStr.toLowerCase().match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/);
  if (monthMatch) {
    result.month = monthNames[monthMatch[1]];
  }

  // Try to extract day
  const dayMatch = dateStr.match(/\b(\d{1,2})\b/);
  if (dayMatch && parseInt(dayMatch[1], 10) <= 31) {
    const day = parseInt(dayMatch[1], 10);
    // Make sure this isn't the year
    if (day !== result.year) {
      result.day = day;
    }
  }

  return result;
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
 * Extract a life event object suitable for the life_event table
 */
const extractLifeEvent = (fact, factId) => {
  if (!fact) return null;

  const event = {
    sourceId: factId || fact.id,
    eventType: fact.type,
  };

  // Value (occupation name, title, etc.)
  if (fact.value) {
    event.value = fact.value;
  }

  // Date extraction
  if (fact.date) {
    event.dateOriginal = fact.date.original || fact.date.normalized?.[0]?.value;
    if (fact.date.formal) {
      event.dateFormal = fact.date.formal;
    }

    // Parse date components
    const dateSource = fact.date.formal || event.dateOriginal;
    const components = parseDateComponents(dateSource);
    if (components.year !== undefined) event.dateYear = components.year;
    if (components.month !== undefined) event.dateMonth = components.month;
    if (components.day !== undefined) event.dateDay = components.day;
  }

  // Place extraction
  if (fact.place) {
    event.placeOriginal = fact.place.original || fact.place.normalized?.[0]?.value;
    if (fact.place.normalized?.[0]?.value && fact.place.normalized[0].value !== event.placeOriginal) {
      event.placeNormalized = fact.place.normalized[0].value;
    }
    // Extract place ID from description (format: "#12345")
    if (fact.place.description?.startsWith("#")) {
      event.placeId = fact.place.description.slice(1);
    }
  }

  // Description/qualifiers
  if (fact.qualifiers) {
    const descriptions = fact.qualifiers
      .filter(q => q.name === "http://gedcomx.org/Description" || q.name === "description")
      .map(q => q.value)
      .filter(Boolean);
    if (descriptions.length > 0) {
      event.description = descriptions.join("; ");
    }

    // Cause (for death events)
    const causes = fact.qualifiers
      .filter(q => q.name === "http://gedcomx.org/Cause" || q.name === "cause")
      .map(q => q.value)
      .filter(Boolean);
    if (causes.length > 0) {
      event.cause = causes.join("; ");
    }
  }

  // Only return if we have meaningful data
  if (!event.value && !event.dateOriginal && !event.placeOriginal) {
    return null;
  }

  return event;
};

/**
 * Extract all life events from facts array
 * Returns array of life event objects for the life_event table
 */
const extractAllLifeEvents = (facts) => {
  if (!facts || !Array.isArray(facts)) return [];

  const events = [];

  for (let i = 0; i < facts.length; i++) {
    const fact = facts[i];
    if (!fact.type) continue;

    // Generate a stable ID for this fact
    const factId = fact.id || `fact-${i}`;

    const event = extractLifeEvent(fact, factId);
    if (event) {
      events.push(event);
    }
  }

  return events;
};

/**
 * Extract notes (LifeSketch, memories, etc.)
 */
const extractNotes = (facts, selfRef) => {
  const notes = [];

  // LifeSketch from facts
  const lifeSketchFact = findFact(facts, TYPES.LIFE_SKETCH);
  if (lifeSketchFact?.value) {
    notes.push({
      noteType: "life_sketch",
      content: lifeSketchFact.value,
      sourceId: lifeSketchFact.id,
    });
  }

  // Also check for notes in the person's notes array (if present)
  if (selfRef?.notes) {
    for (const note of selfRef.notes) {
      if (note.text) {
        notes.push({
          noteType: note.type || "custom",
          content: note.text,
          sourceId: note.id,
        });
      }
    }
  }

  return notes;
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
 *
 * Returns an object with:
 * - Standard person fields (name, birth, death, etc.)
 * - allLifeEvents: Array of all facts for the life_event table
 * - notes: Array of notes/life sketches for the note table
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

  // =========================================================================
  // EXPANDED DATA EXTRACTION (for life_event and note tables)
  // =========================================================================

  // Extract all life events (all facts including birth/death/burial/occupation)
  const allLifeEvents = extractAllLifeEvents(facts);

  // Extract notes (life sketches, memories, etc.)
  const notes = extractNotes(facts, selfRef);

  // Extract religion (for backwards compat and quick access)
  const religionFact = findFact(facts, "http://gedcomx.org/Religion");
  const religion = religionFact?.value;

  // Extract title of nobility
  const titleFacts = findAllFacts(facts, TITLE_TYPES);
  const titleOfNobility = titleFacts.length > 0 ? titleFacts[0].value : undefined;

  // Extract military service
  const militaryFact = findFact(facts, "http://gedcomx.org/MilitaryService");
  const militaryService = militaryFact?.value;

  // Extract cause of death
  const deathFact = findFact(facts, TYPES.DEATH);
  const causeOfDeath = deathFact?.qualifiers?.find(
    q => q.name === "http://gedcomx.org/Cause" || q.name === "cause"
  )?.value;

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
    religion,
    bio,

    // Quick access fields (also in allLifeEvents)
    titleOfNobility,
    militaryService,
    causeOfDeath,

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

    // =========================================================================
    // EXPANDED DATA (for SQLite life_event and note tables)
    // =========================================================================
    allLifeEvents,
    notes,
  };
};

export default json2person;
