import fs from 'fs';
import https from 'https';
import http from 'http';

/**
 * Download an image from a URL to a local file path.
 * Handles http/https, follows 301/302 redirects, rejects non-200,
 * and cleans up partial files on error.
 */
export function downloadImage(url: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const protocol = parsedUrl.protocol === 'https:' ? https : http;

    const options = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      headers: {
        'User-Agent': 'SparseTree/1.0 (https://github.com/atomantic/SparseTree)',
      },
    };

    const file = fs.createWriteStream(destPath);

    protocol.get(options, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        const redirectUrl = response.headers.location;
        if (redirectUrl) {
          file.close();
          fs.unlink(destPath, () => {});
          const fullRedirectUrl = redirectUrl.startsWith('http')
            ? redirectUrl
            : new URL(redirectUrl, url).toString();
          downloadImage(fullRedirectUrl, destPath).then(resolve).catch(reject);
          return;
        }
      }

      if (response.statusCode !== 200) {
        file.close();
        fs.unlink(destPath, () => {});
        reject(new Error(`Failed to download: HTTP ${response.statusCode}`));
        return;
      }

      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve();
      });
    }).on('error', (err) => {
      file.close();
      fs.unlink(destPath, () => {});
      reject(err);
    });
  });
}
