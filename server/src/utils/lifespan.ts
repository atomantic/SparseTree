/**
 * Build a human-readable lifespan string from optional birth/death years.
 * Examples: "1850-1920", "1850-", "-1920", ""
 */
export function buildLifespan(birthYear?: number | null, deathYear?: number | null): string {
  const birth = birthYear != null ? String(birthYear) : '';
  const death = deathYear != null ? String(deathYear) : '';
  if (!birth && !death) return '';
  return `${birth}-${death}`;
}
