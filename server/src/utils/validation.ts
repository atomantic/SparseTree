/**
 * Validate that a string is a canonical 26-character ULID.
 */
export function isCanonicalId(id: string): boolean {
  return /^[0-9A-HJKMNP-TV-Z]{26}$/i.test(id);
}

/**
 * Validate a URL using the URL constructor.
 * Optionally requires the hostname to include a specific domain.
 */
export function isValidUrl(url: string, requiredDomain?: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  if (requiredDomain && parsed.hostname !== requiredDomain && !parsed.hostname.endsWith('.' + requiredDomain)) return false;
  return true;
}

/**
 * Sanitize a person ID by stripping path separators and ".." sequences.
 * Prevents path traversal attacks when used in file path construction.
 */
export function sanitizePersonId(id: string): string {
  const decoded = decodeURIComponent(id);
  const sanitized = decoded.replace(/[/\\]/g, '').replace(/\.\./g, '');
  if (!/^[\w:-]+$/.test(sanitized)) return '';
  return sanitized;
}

/**
 * Escape FTS5 special operators so user input can be safely used in MATCH queries.
 * Removes quotes and special operator characters, then trims whitespace.
 */
export function sanitizeFtsQuery(query: string): string {
  return query.replace(/['"]/g, '').replace(/[{}()*^~]/g, '').trim();
}

/**
 * Whitelist-pick fields from an object. Returns a new object with only the specified keys.
 */
export function pickFields<T extends Record<string, unknown>>(
  obj: T,
  keys: (keyof T)[]
): Partial<T> {
  const result: Partial<T> = {};
  for (const key of keys) {
    if (key in obj) {
      result[key] = obj[key];
    }
  }
  return result;
}
