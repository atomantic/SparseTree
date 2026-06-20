/**
 * Unit tests for server/src/utils/validation.ts
 *
 * Focus: the navigation allowlist (`isAllowedNavigationUrl`) that gates
 * `browserService.navigateTo()` against SSRF (PLAN.md Cleanup & Security:
 * "Add allowlist guard on browserService.navigateTo()").
 */

import { describe, it, expect } from 'vitest';
import {
  isValidUrl,
  isAllowedNavigationUrl,
  ALLOWED_NAVIGATION_DOMAINS,
  isCanonicalId,
} from '../../../server/src/utils/validation.js';

describe('isValidUrl', () => {
  it('accepts http and https URLs', () => {
    expect(isValidUrl('https://example.com')).toBe(true);
    expect(isValidUrl('http://example.com')).toBe(true);
  });

  it('rejects non-http(s) protocols', () => {
    expect(isValidUrl('ftp://example.com')).toBe(false);
    expect(isValidUrl('file:///etc/passwd')).toBe(false);
    expect(isValidUrl('javascript:alert(1)')).toBe(false);
  });

  it('rejects malformed URLs', () => {
    expect(isValidUrl('not a url')).toBe(false);
    expect(isValidUrl('')).toBe(false);
  });

  it('enforces a required domain (host or subdomain)', () => {
    expect(isValidUrl('https://www.familysearch.org/tree/', 'familysearch.org')).toBe(true);
    expect(isValidUrl('https://familysearch.org/tree/', 'familysearch.org')).toBe(true);
    expect(isValidUrl('https://evil.com', 'familysearch.org')).toBe(false);
  });

  it('does not match a domain via suffix smuggling', () => {
    // notfamilysearch.org must NOT satisfy a requiredDomain of familysearch.org
    expect(isValidUrl('https://notfamilysearch.org', 'familysearch.org')).toBe(false);
    expect(isValidUrl('https://familysearch.org.evil.com', 'familysearch.org')).toBe(false);
  });
});

describe('isAllowedNavigationUrl', () => {
  it('allows each configured genealogy domain', () => {
    for (const domain of ALLOWED_NAVIGATION_DOMAINS) {
      expect(isAllowedNavigationUrl(`https://www.${domain}/some/path`)).toBe(true);
    }
  });

  it('allows the real navigation targets used by the app', () => {
    expect(isAllowedNavigationUrl('https://www.familysearch.org/tree/person/details/ABC-123')).toBe(true);
    expect(isAllowedNavigationUrl('https://www.familysearch.org/tree/person/vitals/ABC-123')).toBe(true);
    expect(isAllowedNavigationUrl('https://ident.familysearch.org/identity/login')).toBe(true);
    expect(isAllowedNavigationUrl('https://www.ancestry.com/family-tree/person/tree/1/person/2/facts')).toBe(true);
    expect(isAllowedNavigationUrl('https://www.wikitree.com/wiki/Surname-12345')).toBe(true);
  });

  it('blocks SSRF targets', () => {
    expect(isAllowedNavigationUrl('http://169.254.169.254/latest/meta-data/')).toBe(false);
    expect(isAllowedNavigationUrl('http://localhost:5432/')).toBe(false);
    expect(isAllowedNavigationUrl('http://127.0.0.1/')).toBe(false);
    expect(isAllowedNavigationUrl('https://internal-service.local/admin')).toBe(false);
    expect(isAllowedNavigationUrl('file:///etc/passwd')).toBe(false);
  });

  it('blocks arbitrary external domains', () => {
    expect(isAllowedNavigationUrl('https://evil.com')).toBe(false);
    expect(isAllowedNavigationUrl('https://familysearch.org.evil.com')).toBe(false);
  });

  it('rejects empty and malformed input', () => {
    expect(isAllowedNavigationUrl('')).toBe(false);
    expect(isAllowedNavigationUrl('not a url')).toBe(false);
  });
});

describe('isCanonicalId', () => {
  it('accepts a 26-char ULID', () => {
    expect(isCanonicalId('01ARZ3NDEKTSV4RRFFQ69G5FAV')).toBe(true);
  });

  it('rejects wrong-length or invalid ids', () => {
    expect(isCanonicalId('too-short')).toBe(false);
    expect(isCanonicalId('')).toBe(false);
  });
});
