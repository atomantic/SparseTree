/**
 * GEDCOM-X and FamilySearch Fact Type URIs
 * Reference: https://github.com/FamilySearch/gedcomx/blob/master/specifications/fact-types-specification.md
 *
 * These are used consistently across:
 * - FamilySearch API responses
 * - SQLite life_event storage
 * - GEDCOM export
 */

// ============================================================================
// GEDCOM-X Standard Fact Types
// ============================================================================

export const GEDCOM_FACT_TYPES = {
  // Vital Events
  BIRTH: 'http://gedcomx.org/Birth',
  DEATH: 'http://gedcomx.org/Death',
  BURIAL: 'http://gedcomx.org/Burial',
  CREMATION: 'http://gedcomx.org/Cremation',
  CHRISTENING: 'http://gedcomx.org/Christening',
  BAPTISM: 'http://gedcomx.org/Baptism',
  CONFIRMATION: 'http://gedcomx.org/Confirmation',

  // Marriage & Family
  MARRIAGE: 'http://gedcomx.org/Marriage',
  MARRIAGE_BANNS: 'http://gedcomx.org/MarriageBanns',
  MARRIAGE_CONTRACT: 'http://gedcomx.org/MarriageContract',
  MARRIAGE_LICENSE: 'http://gedcomx.org/MarriageLicense',
  DIVORCE: 'http://gedcomx.org/Divorce',
  ANNULMENT: 'http://gedcomx.org/Annulment',
  ADOPTION: 'http://gedcomx.org/Adoption',

  // Occupation & Education
  OCCUPATION: 'http://gedcomx.org/Occupation',
  EDUCATION: 'http://gedcomx.org/Education',
  RETIREMENT: 'http://gedcomx.org/Retirement',
  APPRENTICESHIP: 'http://gedcomx.org/Apprenticeship',

  // Military
  MILITARY_SERVICE: 'http://gedcomx.org/MilitaryService',
  MILITARY_AWARD: 'http://gedcomx.org/MilitaryAward',
  MILITARY_DISCHARGE: 'http://gedcomx.org/MilitaryDischarge',

  // Residence & Migration
  RESIDENCE: 'http://gedcomx.org/Residence',
  IMMIGRATION: 'http://gedcomx.org/Immigration',
  EMIGRATION: 'http://gedcomx.org/Emigration',
  NATURALIZATION: 'http://gedcomx.org/Naturalization',

  // Religious
  RELIGION: 'http://gedcomx.org/Religion',
  ORDINATION: 'http://gedcomx.org/Ordination',
  BAR_MITZVAH: 'http://gedcomx.org/BarMitzvah',
  BAT_MITZVAH: 'http://gedcomx.org/BatMitzvah',

  // Legal & Records
  CENSUS: 'http://gedcomx.org/Census',
  WILL: 'http://gedcomx.org/Will',
  PROBATE: 'http://gedcomx.org/Probate',
  LAND_TRANSACTION: 'http://gedcomx.org/LandTransaction',
  NATIONAL_ID: 'http://gedcomx.org/NationalId',

  // Physical Description
  PHYSICAL_DESCRIPTION: 'http://gedcomx.org/PhysicalDescription',
  ETHNICITY: 'http://gedcomx.org/Ethnicity',
  NATIONALITY: 'http://gedcomx.org/Nationality',
  CASTE: 'http://gedcomx.org/Caste',

  // Misc
  EXCOMMUNICATION: 'http://gedcomx.org/Excommunication',
  MEDICAL_CONDITION: 'http://gedcomx.org/MedicalCondition',
  NUMBER_OF_MARRIAGES: 'http://gedcomx.org/NumberOfMarriages',
  NUMBER_OF_CHILDREN: 'http://gedcomx.org/NumberOfChildren',
} as const;

// ============================================================================
// FamilySearch Custom Fact Types
// These use the data: URI scheme for custom/extension types
// ============================================================================

export const FAMILYSEARCH_FACT_TYPES = {
  // Nobility & Titles
  TITLE_OF_NOBILITY: 'data:,TitleOfNobility',
  HEREDITARY_TITLE: 'data:,HereditaryTitle',

  // Biographical
  LIFE_SKETCH: 'data:,LifeSketch',
  CAUSE_OF_DEATH: 'data:,CauseOfDeath',

  // Tribal/Clan
  TRIBE_NAME: 'data:,TribeName',
  CLAN: 'data:,Clan',
  AFFILIATION: 'data:,Affiliation',

  // Immigration details
  DESTINATION: 'data:,Destination',
  ORIGIN: 'data:,Origin',
  PORT_OF_DEPARTURE: 'data:,PortOfDeparture',
  PORT_OF_ARRIVAL: 'data:,PortOfArrival',
  VESSEL: 'data:,Vessel',

  // Property
  PROPERTY: 'data:,Property',

  // Misc
  STILLBORN: 'data:,Stillborn',
  DIED_BEFORE_EIGHT: 'data:,DiedBeforeEight',
  NOT_ACCOUNTABLE: 'data:,NotAccountable',
  COMMON_LAW_MARRIAGE: 'data:,CommonLawMarriage',
} as const;

// ============================================================================
// Combined type mapping for lookup
// ============================================================================

export const ALL_FACT_TYPES = {
  ...GEDCOM_FACT_TYPES,
  ...FAMILYSEARCH_FACT_TYPES,
} as const;

export type GedcomFactType = typeof GEDCOM_FACT_TYPES[keyof typeof GEDCOM_FACT_TYPES];
export type FamilySearchFactType = typeof FAMILYSEARCH_FACT_TYPES[keyof typeof FAMILYSEARCH_FACT_TYPES];
export type FactType = GedcomFactType | FamilySearchFactType;

// ============================================================================
// Human-readable labels for display
// ============================================================================

export const FACT_TYPE_LABELS: Record<string, string> = {
  // GEDCOM-X
  [GEDCOM_FACT_TYPES.BIRTH]: 'Birth',
  [GEDCOM_FACT_TYPES.DEATH]: 'Death',
  [GEDCOM_FACT_TYPES.BURIAL]: 'Burial',
  [GEDCOM_FACT_TYPES.CREMATION]: 'Cremation',
  [GEDCOM_FACT_TYPES.CHRISTENING]: 'Christening',
  [GEDCOM_FACT_TYPES.BAPTISM]: 'Baptism',
  [GEDCOM_FACT_TYPES.CONFIRMATION]: 'Confirmation',
  [GEDCOM_FACT_TYPES.MARRIAGE]: 'Marriage',
  [GEDCOM_FACT_TYPES.MARRIAGE_BANNS]: 'Marriage Banns',
  [GEDCOM_FACT_TYPES.MARRIAGE_CONTRACT]: 'Marriage Contract',
  [GEDCOM_FACT_TYPES.MARRIAGE_LICENSE]: 'Marriage License',
  [GEDCOM_FACT_TYPES.DIVORCE]: 'Divorce',
  [GEDCOM_FACT_TYPES.ANNULMENT]: 'Annulment',
  [GEDCOM_FACT_TYPES.ADOPTION]: 'Adoption',
  [GEDCOM_FACT_TYPES.OCCUPATION]: 'Occupation',
  [GEDCOM_FACT_TYPES.EDUCATION]: 'Education',
  [GEDCOM_FACT_TYPES.RETIREMENT]: 'Retirement',
  [GEDCOM_FACT_TYPES.APPRENTICESHIP]: 'Apprenticeship',
  [GEDCOM_FACT_TYPES.MILITARY_SERVICE]: 'Military Service',
  [GEDCOM_FACT_TYPES.MILITARY_AWARD]: 'Military Award',
  [GEDCOM_FACT_TYPES.MILITARY_DISCHARGE]: 'Military Discharge',
  [GEDCOM_FACT_TYPES.RESIDENCE]: 'Residence',
  [GEDCOM_FACT_TYPES.IMMIGRATION]: 'Immigration',
  [GEDCOM_FACT_TYPES.EMIGRATION]: 'Emigration',
  [GEDCOM_FACT_TYPES.NATURALIZATION]: 'Naturalization',
  [GEDCOM_FACT_TYPES.RELIGION]: 'Religion',
  [GEDCOM_FACT_TYPES.ORDINATION]: 'Ordination',
  [GEDCOM_FACT_TYPES.BAR_MITZVAH]: 'Bar Mitzvah',
  [GEDCOM_FACT_TYPES.BAT_MITZVAH]: 'Bat Mitzvah',
  [GEDCOM_FACT_TYPES.CENSUS]: 'Census',
  [GEDCOM_FACT_TYPES.WILL]: 'Will',
  [GEDCOM_FACT_TYPES.PROBATE]: 'Probate',
  [GEDCOM_FACT_TYPES.LAND_TRANSACTION]: 'Land Transaction',
  [GEDCOM_FACT_TYPES.NATIONAL_ID]: 'National ID',
  [GEDCOM_FACT_TYPES.PHYSICAL_DESCRIPTION]: 'Physical Description',
  [GEDCOM_FACT_TYPES.ETHNICITY]: 'Ethnicity',
  [GEDCOM_FACT_TYPES.NATIONALITY]: 'Nationality',
  [GEDCOM_FACT_TYPES.CASTE]: 'Caste',
  [GEDCOM_FACT_TYPES.EXCOMMUNICATION]: 'Excommunication',
  [GEDCOM_FACT_TYPES.MEDICAL_CONDITION]: 'Medical Condition',
  [GEDCOM_FACT_TYPES.NUMBER_OF_MARRIAGES]: 'Number of Marriages',
  [GEDCOM_FACT_TYPES.NUMBER_OF_CHILDREN]: 'Number of Children',

  // FamilySearch Custom
  [FAMILYSEARCH_FACT_TYPES.TITLE_OF_NOBILITY]: 'Title of Nobility',
  [FAMILYSEARCH_FACT_TYPES.HEREDITARY_TITLE]: 'Hereditary Title',
  [FAMILYSEARCH_FACT_TYPES.LIFE_SKETCH]: 'Life Sketch',
  [FAMILYSEARCH_FACT_TYPES.CAUSE_OF_DEATH]: 'Cause of Death',
  [FAMILYSEARCH_FACT_TYPES.TRIBE_NAME]: 'Tribe Name',
  [FAMILYSEARCH_FACT_TYPES.CLAN]: 'Clan',
  [FAMILYSEARCH_FACT_TYPES.AFFILIATION]: 'Affiliation',
  [FAMILYSEARCH_FACT_TYPES.DESTINATION]: 'Destination',
  [FAMILYSEARCH_FACT_TYPES.ORIGIN]: 'Origin',
  [FAMILYSEARCH_FACT_TYPES.PORT_OF_DEPARTURE]: 'Port of Departure',
  [FAMILYSEARCH_FACT_TYPES.PORT_OF_ARRIVAL]: 'Port of Arrival',
  [FAMILYSEARCH_FACT_TYPES.VESSEL]: 'Vessel',
  [FAMILYSEARCH_FACT_TYPES.PROPERTY]: 'Property',
  [FAMILYSEARCH_FACT_TYPES.STILLBORN]: 'Stillborn',
  [FAMILYSEARCH_FACT_TYPES.DIED_BEFORE_EIGHT]: 'Died Before Eight',
  [FAMILYSEARCH_FACT_TYPES.NOT_ACCOUNTABLE]: 'Not Accountable',
  [FAMILYSEARCH_FACT_TYPES.COMMON_LAW_MARRIAGE]: 'Common Law Marriage',
};

/**
 * Get human-readable label for a fact type URI
 */
export function getFactTypeLabel(typeUri: string): string {
  return FACT_TYPE_LABELS[typeUri] || typeUri.split('/').pop()?.replace(/([A-Z])/g, ' $1').trim() || typeUri;
}

/**
 * Check if a fact type is a vital event (birth, death, burial, etc.)
 */
export function isVitalEvent(typeUri: string): boolean {
  const vitalTypes: string[] = [
    GEDCOM_FACT_TYPES.BIRTH,
    GEDCOM_FACT_TYPES.DEATH,
    GEDCOM_FACT_TYPES.BURIAL,
    GEDCOM_FACT_TYPES.CREMATION,
    GEDCOM_FACT_TYPES.CHRISTENING,
    GEDCOM_FACT_TYPES.BAPTISM,
  ];
  return vitalTypes.includes(typeUri);
}

/**
 * Categorize fact types for UI display
 */
export const FACT_CATEGORIES = {
  vital: [
    GEDCOM_FACT_TYPES.BIRTH,
    GEDCOM_FACT_TYPES.DEATH,
    GEDCOM_FACT_TYPES.BURIAL,
    GEDCOM_FACT_TYPES.CREMATION,
    FAMILYSEARCH_FACT_TYPES.CAUSE_OF_DEATH,
  ],
  religious: [
    GEDCOM_FACT_TYPES.CHRISTENING,
    GEDCOM_FACT_TYPES.BAPTISM,
    GEDCOM_FACT_TYPES.CONFIRMATION,
    GEDCOM_FACT_TYPES.RELIGION,
    GEDCOM_FACT_TYPES.ORDINATION,
    GEDCOM_FACT_TYPES.BAR_MITZVAH,
    GEDCOM_FACT_TYPES.BAT_MITZVAH,
    GEDCOM_FACT_TYPES.EXCOMMUNICATION,
  ],
  family: [
    GEDCOM_FACT_TYPES.MARRIAGE,
    GEDCOM_FACT_TYPES.MARRIAGE_BANNS,
    GEDCOM_FACT_TYPES.MARRIAGE_CONTRACT,
    GEDCOM_FACT_TYPES.MARRIAGE_LICENSE,
    GEDCOM_FACT_TYPES.DIVORCE,
    GEDCOM_FACT_TYPES.ANNULMENT,
    GEDCOM_FACT_TYPES.ADOPTION,
    FAMILYSEARCH_FACT_TYPES.COMMON_LAW_MARRIAGE,
  ],
  occupation: [
    GEDCOM_FACT_TYPES.OCCUPATION,
    GEDCOM_FACT_TYPES.EDUCATION,
    GEDCOM_FACT_TYPES.RETIREMENT,
    GEDCOM_FACT_TYPES.APPRENTICESHIP,
  ],
  military: [
    GEDCOM_FACT_TYPES.MILITARY_SERVICE,
    GEDCOM_FACT_TYPES.MILITARY_AWARD,
    GEDCOM_FACT_TYPES.MILITARY_DISCHARGE,
  ],
  residence: [
    GEDCOM_FACT_TYPES.RESIDENCE,
    GEDCOM_FACT_TYPES.IMMIGRATION,
    GEDCOM_FACT_TYPES.EMIGRATION,
    GEDCOM_FACT_TYPES.NATURALIZATION,
    FAMILYSEARCH_FACT_TYPES.DESTINATION,
    FAMILYSEARCH_FACT_TYPES.ORIGIN,
    FAMILYSEARCH_FACT_TYPES.PORT_OF_DEPARTURE,
    FAMILYSEARCH_FACT_TYPES.PORT_OF_ARRIVAL,
    FAMILYSEARCH_FACT_TYPES.VESSEL,
  ],
  social: [
    FAMILYSEARCH_FACT_TYPES.TITLE_OF_NOBILITY,
    FAMILYSEARCH_FACT_TYPES.HEREDITARY_TITLE,
    GEDCOM_FACT_TYPES.CASTE,
    FAMILYSEARCH_FACT_TYPES.TRIBE_NAME,
    FAMILYSEARCH_FACT_TYPES.CLAN,
    FAMILYSEARCH_FACT_TYPES.AFFILIATION,
  ],
  legal: [
    GEDCOM_FACT_TYPES.CENSUS,
    GEDCOM_FACT_TYPES.WILL,
    GEDCOM_FACT_TYPES.PROBATE,
    GEDCOM_FACT_TYPES.LAND_TRANSACTION,
    GEDCOM_FACT_TYPES.NATIONAL_ID,
    FAMILYSEARCH_FACT_TYPES.PROPERTY,
  ],
  personal: [
    GEDCOM_FACT_TYPES.PHYSICAL_DESCRIPTION,
    GEDCOM_FACT_TYPES.ETHNICITY,
    GEDCOM_FACT_TYPES.NATIONALITY,
    GEDCOM_FACT_TYPES.MEDICAL_CONDITION,
    FAMILYSEARCH_FACT_TYPES.LIFE_SKETCH,
  ],
} as const;
