import https from 'https';

const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; SparseTree/1.0)',
  'Accept': 'text/html',
};

/**
 * Fetch an HTML page over HTTPS, following 301/302 redirects.
 */
export function fetchHtml(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const doFetch = (targetUrl: string) => {
      https.get(targetUrl, { headers: DEFAULT_HEADERS }, (response) => {
        if (response.statusCode === 301 || response.statusCode === 302) {
          const redirectUrl = response.headers.location;
          if (redirectUrl) {
            doFetch(redirectUrl.startsWith('http') ? redirectUrl : `https:${redirectUrl}`);
            return;
          }
        }
        let data = '';
        response.on('data', chunk => data += chunk);
        response.on('end', () => resolve(data));
      }).on('error', reject);
    };
    doFetch(url);
  });
}
