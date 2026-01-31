/**
 * Lineage Color Scheme
 *
 * Color palettes for paternal (father's side) and maternal (mother's side) lineages.
 * Paternal uses cool colors (blue, teal, green) and maternal uses warm colors (red, coral, tan).
 * Colors are arranged by generation depth for visual distinction.
 */

// Paternal lineage colors (cool tones - blues, teals, greens)
export const PATERNAL_COLORS = [
  '#4A90D9', // Gen 1 - Strong blue
  '#5BA8A0', // Gen 2 - Teal
  '#6BC5B8', // Gen 3 - Soft teal
  '#7AD4C7', // Gen 4 - Light teal
  '#89E3D6', // Gen 5 - Pale teal
  '#98F2E5', // Gen 6+ - Very light teal
];

// Maternal lineage colors (warm tones - reds, corals, tans)
export const MATERNAL_COLORS = [
  '#D94A4A', // Gen 1 - Strong red
  '#E87D5F', // Gen 2 - Coral
  '#F5A07A', // Gen 3 - Soft coral
  '#FFB899', // Gen 4 - Light coral
  '#FFCFB8', // Gen 5 - Pale peach
  '#FFE5D7', // Gen 6+ - Very light peach
];

// Gender-specific colors (for person cards)
export const GENDER_COLORS = {
  male: {
    border: 'var(--color-male)',
    bg: 'var(--color-male-subtle)',
    bgHover: 'rgba(111, 143, 179, 0.25)',
  },
  female: {
    border: 'var(--color-female)',
    bg: 'var(--color-female-subtle)',
    bgHover: 'rgba(176, 125, 138, 0.25)',
  },
  unknown: {
    border: 'var(--color-app-border)',
    bg: 'var(--color-app-bg-secondary)',
    bgHover: 'var(--color-app-hover)',
  },
};

/**
 * Get lineage color for a specific generation
 */
export function getLineageColor(lineage: 'paternal' | 'maternal', generation: number): string {
  const colors = lineage === 'paternal' ? PATERNAL_COLORS : MATERNAL_COLORS;
  const index = Math.min(generation - 1, colors.length - 1);
  return colors[Math.max(0, index)];
}

/**
 * Get lineage color with opacity for backgrounds
 */
export function getLineageColorWithOpacity(
  lineage: 'paternal' | 'maternal',
  generation: number,
  opacity: number = 0.3
): string {
  const hex = getLineageColor(lineage, generation);
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

/**
 * Determine lineage from ahnentafel number
 * Ahnentafel: 1=self, 2=father, 3=mother, 4=paternal grandfather, etc.
 * Father's line: even numbers (2, 4, 6, 8...)
 * Mother's line: odd numbers > 1 (3, 5, 7, 9...)
 */
export function getLineageFromAhnentafel(ahnentafel: number): 'paternal' | 'maternal' | 'self' {
  if (ahnentafel === 1) return 'self';
  // Track back to see if we came from position 2 (father) or 3 (mother)
  let n = ahnentafel;
  while (n > 3) {
    n = Math.floor(n / 2);
  }
  return n === 2 ? 'paternal' : 'maternal';
}

/**
 * Get generation from ahnentafel number
 * Gen 0 = self (1), Gen 1 = parents (2-3), Gen 2 = grandparents (4-7), etc.
 */
export function getGenerationFromAhnentafel(ahnentafel: number): number {
  return Math.floor(Math.log2(ahnentafel));
}

/**
 * Calculate ahnentafel number for a position in the pedigree
 * Position is 0-indexed within the generation
 */
export function calculateAhnentafel(generation: number, position: number): number {
  return Math.pow(2, generation) + position;
}

/**
 * CSS variables for lineage colors (to be added to index.css)
 */
export const LINEAGE_CSS_VARS = `
  /* Paternal lineage colors (cool tones) */
  --color-lineage-paternal-1: #4A90D9;
  --color-lineage-paternal-2: #5BA8A0;
  --color-lineage-paternal-3: #6BC5B8;
  --color-lineage-paternal-4: #7AD4C7;
  --color-lineage-paternal-5: #89E3D6;

  /* Maternal lineage colors (warm tones) */
  --color-lineage-maternal-1: #D94A4A;
  --color-lineage-maternal-2: #E87D5F;
  --color-lineage-maternal-3: #F5A07A;
  --color-lineage-maternal-4: #FFB899;
  --color-lineage-maternal-5: #FFCFB8;
`;
