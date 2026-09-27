import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SearchResult } from '@fsf/shared';
import { api } from '../../services/api';
import { LinkRelationshipDialog } from './LinkRelationshipDialog';

vi.mock('../../services/api', () => ({
  api: {
    addRelationship: vi.fn(),
    search: vi.fn(),
  },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function searchResult(name: string): SearchResult {
  return {
    results: [{ id: `person-${name}`, name, lifespan: '', gender: 'unknown' } as SearchResult['results'][number]],
    total: 1,
    page: 1,
    limit: 10,
    totalPages: 1,
  };
}

function DialogFixture() {
  const [open, setOpen] = useState(true);

  return (
    <>
      {!open && <button type="button" onClick={() => setOpen(true)}>Open relationship linker</button>}
      <LinkRelationshipDialog
        open={open}
        dbId="db-id"
        personId="current-person"
        onClose={() => setOpen(false)}
        onLinked={vi.fn()}
      />
    </>
  );
}

async function advanceDebounce() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
  });
}

afterEach(() => cleanup());

describe('LinkRelationshipDialog search lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('ignores an older response and keeps the newer request loading', async () => {
    const oldSearch = deferred<SearchResult>();
    const currentSearch = deferred<SearchResult>();
    vi.mocked(api.search)
      .mockReturnValueOnce(oldSearch.promise)
      .mockReturnValueOnce(currentSearch.promise);

    render(<DialogFixture />);
    const input = screen.getByRole('textbox', { name: 'Search people' });

    fireEvent.change(input, { target: { value: 'Al' } });
    await advanceDebounce();
    expect(api.search).toHaveBeenCalledTimes(1);

    fireEvent.change(input, { target: { value: 'Alice' } });
    await advanceDebounce();
    expect(api.search).toHaveBeenCalledTimes(2);

    await act(async () => {
      oldSearch.resolve(searchResult('Old Alice'));
      await oldSearch.promise;
    });
    expect(screen.queryByText('Old Alice')).toBeNull();
    expect(document.querySelector('svg.animate-spin')).not.toBeNull();

    await act(async () => {
      currentSearch.resolve(searchResult('Current Alice'));
      await currentSearch.promise;
    });
    expect(screen.getByText('Current Alice')).not.toBeNull();
    expect(document.querySelector('svg.animate-spin')).toBeNull();
  });

  it('clears pending search state for a short query and does not schedule another request', async () => {
    const pendingSearch = deferred<SearchResult>();
    vi.mocked(api.search).mockReturnValueOnce(pendingSearch.promise);

    render(<DialogFixture />);
    const input = screen.getByRole('textbox', { name: 'Search people' });

    fireEvent.change(input, { target: { value: 'Al' } });
    await advanceDebounce();
    expect(api.search).toHaveBeenCalledTimes(1);

    fireEvent.change(input, { target: { value: 'A' } });
    expect(document.querySelector('svg.animate-spin')).toBeNull();
    await advanceDebounce();
    expect(api.search).toHaveBeenCalledTimes(1);

    await act(async () => {
      pendingSearch.resolve(searchResult('Late Alice'));
      await pendingSearch.promise;
    });
    expect(screen.queryByText('Late Alice')).toBeNull();
    expect(screen.queryByText(/No results found/)).toBeNull();
  });

  it('ignores a pending response after close and reopen', async () => {
    const pendingSearch = deferred<SearchResult>();
    vi.mocked(api.search).mockReturnValueOnce(pendingSearch.promise);

    render(<DialogFixture />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Search people' }), { target: { value: 'Al' } });
    await advanceDebounce();

    fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
    expect(screen.queryByRole('dialog', { name: 'Add Relationship' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open relationship linker' }));

    await act(async () => {
      pendingSearch.resolve(searchResult('Late Alice'));
      await pendingSearch.promise;
    });
    expect(screen.getByRole('textbox', { name: 'Search people' })).toHaveProperty('value', '');
    expect(screen.queryByText('Late Alice')).toBeNull();
    expect(document.querySelector('svg.animate-spin')).toBeNull();
  });

  it('clears the loading state when the current search rejects', async () => {
    vi.mocked(api.search).mockRejectedValueOnce(new Error('search unavailable'));

    render(<DialogFixture />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Search people' }), { target: { value: 'Al' } });
    await advanceDebounce();

    await act(async () => {
      await Promise.resolve();
    });
    expect(document.querySelector('svg.animate-spin')).toBeNull();
  });
});
