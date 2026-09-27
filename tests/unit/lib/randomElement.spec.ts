import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomElement } from '../../../server/src/lib/graph/randomElement.js';

afterEach(() => vi.restoreAllMocks());

describe('randomElement', () => {
  it('returns undefined for an empty list without requesting randomness', () => {
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5);

    expect(randomElement([])).toBeUndefined();
    expect(randomSpy).not.toHaveBeenCalled();
  });

  it('selects items at the generated index from a readonly list', () => {
    const items = ['first', 'middle', 'last'] as const;
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);

    expect(randomElement(items)).toBe('first');
    randomSpy.mockReturnValue(0.999);
    expect(randomElement(items)).toBe('last');
  });
});
