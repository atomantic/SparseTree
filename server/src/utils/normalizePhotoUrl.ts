/**
 * Base URLs for known platforms, used to expand relative photo paths.
 */
const PLATFORM_BASE_URLS: Record<string, string> = {
  ancestry: 'https://www.ancestry.com',
  familysearch: 'https://www.familysearch.org',
  wikitree: 'https://www.wikitree.com',
  wikipedia: 'https://en.wikipedia.org',
  linkedin: 'https://www.linkedin.com',
};

/**
 * Normalize a photo URL to absolute form.
 * - `//foo` → `https://foo`
 * - `/foo`  → `{platform-base}/foo` (if platform is known)
 * - everything else passes through unchanged
 */
export function normalizePhotoUrl(url: string, platform: string): string {
  if (url.startsWith('//')) return 'https:' + url;
  if (url.startsWith('/')) {
    const base = PLATFORM_BASE_URLS[platform];
    return base ? base + url : url;
  }
  return url;
}
