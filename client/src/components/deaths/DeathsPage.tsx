import { useEffect, useState, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Search, Loader2, Skull, Sparkles, X } from 'lucide-react';
import { api } from '../../services/api';
import { deathsApi } from '../../services/deaths-api';
import type { DeathListItem, DeathListResult } from '../../services/deaths-api';
import type { DatabaseInfo } from '@fsf/shared';

const PAGE_SIZE = 50;

export function DeathsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState<DeathListResult | null>(null);
  const [databases, setDatabases] = useState<DatabaseInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const q = searchParams.get('q') || '';
  const unusual = searchParams.get('unusual') === '1';
  const dbId = searchParams.get('db') || '';
  const offset = parseInt(searchParams.get('offset') || '0', 10);

  const load = useCallback(() => {
    setLoading(true);
    deathsApi
      .list({
        q: q || undefined,
        unusual,
        dbId: dbId || undefined,
        limit: PAGE_SIZE,
        offset,
      })
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [q, unusual, dbId, offset]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    api.listDatabases().then(setDatabases).catch(console.error);
  }, []);

  const updateParam = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete('offset');
    setSearchParams(next);
  };

  const goToOffset = (next: number) => {
    const params = new URLSearchParams(searchParams);
    if (next > 0) params.set('offset', String(next));
    else params.delete('offset');
    setSearchParams(params);
  };

  const linkDbId = dbId || databases[0]?.id || '';

  return (
    <div className="max-w-6xl mx-auto p-4 space-y-4">
      <div className="flex items-center gap-3">
        <Skull size={28} className="text-app-accent" />
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-app-text">Causes of Death</h1>
          <p className="text-sm text-app-text-muted">
            Browse, search, and verify how your ancestors met their end.
          </p>
        </div>
      </div>

      <div className="bg-app-card border border-app-border rounded-lg p-3 sm:p-4 space-y-3">
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1 min-w-0">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-app-text-subtle" />
            <input
              type="text"
              placeholder="Search cause, circumstance, or name…"
              value={q}
              onChange={e => updateParam('q', e.target.value)}
              className="w-full pl-9 pr-3 py-2 min-h-[40px] bg-app-bg border border-app-border rounded text-app-text placeholder-app-placeholder focus:border-app-accent focus:outline-none"
            />
          </div>

          {databases.length > 1 && (
            <select
              value={dbId}
              onChange={e => updateParam('db', e.target.value)}
              className="px-3 py-2 min-h-[40px] bg-app-bg border border-app-border rounded text-app-text focus:border-app-accent focus:outline-none cursor-pointer"
            >
              <option value="">All trees</option>
              {databases.map(db => (
                <option key={db.id} value={db.id}>{db.rootName || db.id}</option>
              ))}
            </select>
          )}

          <button
            onClick={() => updateParam('unusual', unusual ? '' : '1')}
            className={`flex items-center gap-1 px-3 py-2 min-h-[40px] rounded border transition-colors ${
              unusual
                ? 'bg-app-accent text-white border-app-accent'
                : 'bg-app-bg border-app-border text-app-text hover:border-app-accent'
            }`}
            title="Show only deaths flagged manually or matching keywords"
          >
            <Sparkles size={14} />
            <span className="text-sm whitespace-nowrap">Unusual only</span>
          </button>

          {(q || unusual || dbId) && (
            <button
              onClick={() => setSearchParams({})}
              className="flex items-center gap-1 px-3 py-2 min-h-[40px] text-app-text-muted hover:text-app-text"
            >
              <X size={14} />
              <span className="text-sm">Clear</span>
            </button>
          )}
        </div>

        {data && (
          <div className="text-xs text-app-text-muted">
            {data.total.toLocaleString()} {unusual ? 'unusual death' : 'recorded cause'}
            {data.total === 1 ? '' : 's'}
            {q ? ` matching "${q}"` : ''}
          </div>
        )}
      </div>

      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 size={28} className="animate-spin text-app-accent" />
        </div>
      )}

      {!loading && data && data.items.length === 0 && (
        <div className="text-center py-12 bg-app-card border border-app-border rounded-lg">
          <Skull size={36} className="mx-auto text-app-text-subtle mb-3" />
          <p className="text-app-text-muted">
            No deaths recorded with cause data yet.
            {!q && ' Add one from a person’s page.'}
          </p>
        </div>
      )}

      {!loading && data && data.items.length > 0 && (
        <div className="bg-app-card border border-app-border rounded-lg divide-y divide-app-border">
          {data.items.map(item => (
            <DeathRow key={item.personId} item={item} dbId={linkDbId} />
          ))}
        </div>
      )}

      {data && data.total > PAGE_SIZE && (
        <div className="flex justify-center gap-2">
          <button
            disabled={offset === 0}
            onClick={() => goToOffset(Math.max(0, offset - PAGE_SIZE))}
            className="px-3 py-2 bg-app-border text-app-text-secondary rounded hover:bg-app-hover disabled:opacity-50"
          >
            ← Prev
          </button>
          <span className="px-3 py-2 text-app-text-muted text-sm">
            {offset + 1}–{Math.min(offset + PAGE_SIZE, data.total)} of {data.total.toLocaleString()}
          </span>
          <button
            disabled={offset + PAGE_SIZE >= data.total}
            onClick={() => goToOffset(offset + PAGE_SIZE)}
            className="px-3 py-2 bg-app-border text-app-text-secondary rounded hover:bg-app-hover disabled:opacity-50"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}

function DeathRow({ item, dbId }: { item: DeathListItem; dbId: string }) {
  const lifespan = item.birthYear || item.deathYear
    ? `${item.birthYear ?? '?'}–${item.deathYear ?? '?'}`
    : null;

  const personHref = dbId ? `/person/${dbId}/${item.personId}` : `#`;

  return (
    <div className="p-3 sm:p-4 hover:bg-app-hover transition-colors">
      <div className="flex flex-col sm:flex-row sm:items-baseline gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Link
              to={personHref}
              className="font-medium text-app-text hover:text-app-accent truncate"
            >
              {item.displayName}
            </Link>
            {lifespan && (
              <span className="text-xs text-app-text-muted">{lifespan}</span>
            )}
            {item.isUnusualManual && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-app-accent text-white">
                Unusual
              </span>
            )}
            {item.isUnusualAuto && !item.isUnusualManual && (
              <span
                className="text-xs px-1.5 py-0.5 rounded border border-app-accent text-app-accent"
                title={`Matched keyword: ${item.matchedKeywords.join(', ')}`}
              >
                Auto: {item.matchedKeywords[0]}
              </span>
            )}
          </div>

          {item.cause && (
            <div className="mt-1 text-sm text-app-text">
              <span className="text-app-text-muted">Cause: </span>
              {item.cause}
            </div>
          )}
          {item.circumstance && (
            <div className="mt-1 text-sm text-app-text-muted line-clamp-2">
              {item.circumstance}
            </div>
          )}
          {item.deathPlace && (
            <div className="mt-1 text-xs text-app-text-subtle">
              {item.deathPlace}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
