import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findLocalPhoto, getLocalPhotoSuffix, hasLocalPhoto, localPhotoRoute } from '../../../server/src/utils/paths.js';

let photosDir: string;

beforeEach(() => {
  photosDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sparsetree-photos-'));
});

afterEach(() => {
  fs.rmSync(photosDir, { recursive: true, force: true });
});

function createPhoto(personId: string, suffix: string, extension: 'jpg' | 'png'): string {
  const photoPath = path.join(photosDir, `${personId}${suffix}.${extension}`);
  fs.writeFileSync(photoPath, 'photo');
  return photoPath;
}

describe('local photo resolution', () => {
  it('uses one hyphen between person IDs and provider suffixes', () => {
    const photoPath = createPhoto('person-1', '-familysearch', 'jpg');

    expect(getLocalPhotoSuffix('familysearch')).toBe('familysearch');
    expect(findLocalPhoto('person-1', ['familysearch'], photosDir)?.path).toBe(photoPath);
  });

  it('checks jpg before png for each requested source', () => {
    const jpgPath = createPhoto('person-1', '-ancestry', 'jpg');
    createPhoto('person-1', '-ancestry', 'png');

    expect(findLocalPhoto('person-1', ['ancestry'], photosDir)).toEqual({
      source: 'ancestry',
      path: jpgPath,
      extension: 'jpg',
    });
  });

  it('honors source priority before considering a later source', () => {
    const ancestryPng = createPhoto('person-1', '-ancestry', 'png');
    createPhoto('person-1', '-wiki', 'jpg');

    expect(findLocalPhoto('person-1', ['ancestry', 'wiki'], photosDir)).toEqual({
      source: 'ancestry',
      path: ancestryPng,
      extension: 'png',
    });
  });

  it.each([
    ['familysearch', '-familysearch'],
    ['ancestry', '-ancestry'],
    ['wikitree', '-wikitree'],
    ['wiki', '-wiki'],
    ['generic', ''],
    ['linkedin', '-linkedin'],
  ] as const)('resolves the %s filename and route', (source, suffix) => {
    const photoPath = createPhoto('person-1', suffix, 'png');
    expect(findLocalPhoto('person-1', [source], photosDir)).toEqual({
      source,
      path: photoPath,
      extension: 'png',
    });
    expect(localPhotoRoute('person-1', source)).toBe(
      source === 'generic'
        ? '/api/browser/photos/person-1'
        : `/api/augment/person-1/${source}-photo`,
    );
  });

  it('keeps the upload route prefix optional and supports the 23andme lookup used by provider comparison', () => {
    createPhoto('person-1', '-familysearch', 'jpg');
    createPhoto('person-2', '-23andme', 'png');

    expect(localPhotoRoute('person-1', 'familysearch', '')).toBe('/augment/person-1/familysearch-photo');
    expect(hasLocalPhoto('person-2', '23andme', photosDir)).toBe(true);
    expect(findLocalPhoto('person-2', ['generic'], photosDir)).toBeNull();
  });

  it('returns null and false when the requested photo is missing', () => {
    expect(findLocalPhoto('missing', ['ancestry', 'generic'], photosDir)).toBeNull();
    expect(hasLocalPhoto('missing', 'ancestry', photosDir)).toBe(false);
  });
});
