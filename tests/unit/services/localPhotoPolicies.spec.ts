import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getPhotoUrl as getSparseTreePhotoUrl } from '../../../server/src/services/sparse-tree.service.js';
import { resolvePhotoUrl as resolveAncestryTreePhotoUrl } from '../../../server/src/services/ancestry-tree.service.js';
import { getPhotoUrl as getFavoritePhotoUrl } from '../../../server/src/services/favorites.service.js';
import { resolveAncestryUploadPhoto } from '../../../server/src/services/ancestry-upload.service.js';
import { resolveFamilySearchPhoto } from '../../../server/src/services/familysearch-upload.service.js';

let photosDir: string;

beforeEach(() => {
  photosDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sparsetree-photo-policy-'));
});

afterEach(() => {
  fs.rmSync(photosDir, { recursive: true, force: true });
});

function createPhoto(personId: string, suffix: string, extension: 'jpg' | 'png'): string {
  const photoPath = path.join(photosDir, `${personId}${suffix}.${extension}`);
  fs.writeFileSync(photoPath, 'photo');
  return photoPath;
}

describe('local photo caller priorities', () => {
  it('keeps sparse and ancestry trees on ancestry, WikiTree, Wikipedia, then generic photos', () => {
    createPhoto('person-1', '-wikitree', 'jpg');
    createPhoto('person-1', '-wiki', 'jpg');
    createPhoto('person-1', '', 'jpg');

    expect(getSparseTreePhotoUrl('person-1', photosDir)).toBe('/api/augment/person-1/wikitree-photo');
    expect(resolveAncestryTreePhotoUrl('person-1', photosDir)).toBe('/api/augment/person-1/wikitree-photo');

    createPhoto('person-1', '-ancestry', 'png');
    expect(getSparseTreePhotoUrl('person-1', photosDir)).toBe('/api/augment/person-1/ancestry-photo');
    expect(resolveAncestryTreePhotoUrl('person-1', photosDir)).toBe('/api/augment/person-1/ancestry-photo');
  });

  it('keeps favorites Wikipedia-first, with the generic scraper photo as its fallback', () => {
    const wikipediaPath = createPhoto('person-1', '-wiki', 'png');
    createPhoto('person-1', '-ancestry', 'jpg');
    createPhoto('person-1', '-wikitree', 'jpg');
    createPhoto('person-1', '', 'jpg');

    expect(getFavoritePhotoUrl('person-1', {
      id: 'person-1',
      platforms: [],
      photos: [{ url: 'https://example.test/photo.jpg', source: 'wikipedia', localPath: wikipediaPath }],
      descriptions: [],
      updatedAt: '2026-09-27T00:00:00.000Z',
    }, photosDir)).toBe('/api/augment/person-1/wiki-photo');
    expect(getFavoritePhotoUrl('person-1', undefined, photosDir)).toBe('/api/browser/photos/person-1');

    fs.rmSync(path.join(photosDir, 'person-1.jpg'));
    expect(getFavoritePhotoUrl('person-1', undefined, photosDir)).toBeUndefined();
  });

  it('keeps FamilySearch upload priority and generic-versus-suffixed photo detection', () => {
    createPhoto('person-1', '-wiki', 'jpg');
    createPhoto('person-1', '-ancestry', 'png');
    const preferredPhoto = resolveFamilySearchPhoto('person-1', photosDir);
    expect(preferredPhoto.localPhoto?.source).toBe('ancestry');
    expect(preferredPhoto.localPhotoUrl).toBe('/augment/person-1/ancestry-photo');
    expect(preferredPhoto.fsHasPhoto).toBe(false);

    createPhoto('person-2', '', 'png');
    const genericPhoto = resolveFamilySearchPhoto('person-2', photosDir);
    expect(genericPhoto.localPhoto?.source).toBe('generic');
    expect(genericPhoto.localPhotoUrl).toBe('/browser/photos/person-2');
    expect(genericPhoto.fsHasPhoto).toBe(true);

    createPhoto('person-3', '-familysearch', 'jpg');
    const familySearchPhoto = resolveFamilySearchPhoto('person-3', photosDir);
    expect(familySearchPhoto.localPhoto).toBeNull();
    expect(familySearchPhoto.fsHasPhoto).toBe(true);
  });

  it('keeps Ancestry photos as the upload fallback after FamilySearch, WikiTree, Wikipedia, and generic', () => {
    createPhoto('person-1', '-ancestry', 'png');
    expect(resolveAncestryUploadPhoto('person-1', photosDir)).toEqual({
      path: path.join(photosDir, 'person-1-ancestry.png'),
      url: '/augment/person-1/ancestry-photo',
      isFromAncestry: true,
    });

    createPhoto('person-1', '', 'jpg');
    expect(resolveAncestryUploadPhoto('person-1', photosDir)).toEqual({
      path: path.join(photosDir, 'person-1.jpg'),
      url: '/browser/photos/person-1',
      isFromAncestry: false,
    });
  });
});
