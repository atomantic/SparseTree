import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import type { PathResult } from '@fsf/shared';
import { api } from '../../services/api';

export function PathFinder() {
  const { dbId } = useParams<{ dbId: string }>();
  const [source, setSource] = useState('');
  const [target, setTarget] = useState('');
  const [method, setMethod] = useState<'shortest' | 'longest' | 'random'>('shortest');
  const [result, setResult] = useState<PathResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFindPath = async () => {
    if (!dbId || !source || !target) return;

    setLoading(true);
    setError(null);
    setResult(null);

    const pathResult = await api.findPath(dbId, source, target, method)
      .catch(err => {
        setError(err.message);
        return null;
      });

    if (pathResult) {
      setResult(pathResult);
    }

    setLoading(false);
  };

  return (
    <div className="p-3 sm:p-4 md:p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4 md:mb-6">
        <h1 className="text-xl sm:text-2xl font-bold text-app-text">Find Path</h1>
        <Link
          to={`/tree/${dbId}`}
          className="px-3 py-2 min-h-[40px] flex items-center text-sm text-app-accent hover:underline self-start sm:self-auto"
        >
          Back to tree
        </Link>
      </div>

      <div className="bg-app-card rounded-lg border border-app-border p-3 sm:p-4 mb-4 md:mb-6">
        <div className="grid gap-3 sm:gap-4 sm:grid-cols-2 md:grid-cols-4">
          <input
            type="text"
            placeholder="Source ID (e.g., 9H8F-V2S)"
            value={source}
            onChange={e => setSource(e.target.value.toUpperCase())}
            className="px-3 py-2 min-h-[40px] border rounded-md bg-app-bg text-app-text border-app-border"
          />
          <input
            type="text"
            placeholder="Target ID (e.g., L163-DR5)"
            value={target}
            onChange={e => setTarget(e.target.value.toUpperCase())}
            className="px-3 py-2 min-h-[40px] border rounded-md bg-app-bg text-app-text border-app-border"
          />
          <select
            value={method}
            onChange={e => setMethod(e.target.value as 'shortest' | 'longest' | 'random')}
            className="px-3 py-2 min-h-[40px] border rounded-md bg-app-bg text-app-text border-app-border"
          >
            <option value="shortest">Shortest Path</option>
            <option value="longest">Longest Path</option>
            <option value="random">Random Path</option>
          </select>
          <button
            onClick={handleFindPath}
            disabled={loading || !source || !target}
            className="px-4 py-2 min-h-[40px] bg-app-accent text-app-text rounded-md hover:bg-app-accent-hover disabled:opacity-50"
          >
            {loading ? 'Finding...' : 'Find Path'}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-app-error/10 border border-app-error/30 text-app-error p-3 sm:p-4 rounded-lg mb-4 md:mb-6 text-sm break-words">
          {error}
        </div>
      )}

      {result && (
        <div className="bg-app-card rounded-lg border border-app-border p-3 sm:p-4">
          <h2 className="text-base sm:text-lg font-semibold mb-3 sm:mb-4 text-app-text">
            Path Found: {result.length} generations ({result.method} path)
          </h2>

          <div className="space-y-2">
            {result.path.map((person, index) => (
              <div
                key={person.id}
                className="flex items-center gap-2 sm:gap-4 p-2 sm:p-3 bg-app-bg rounded min-w-0"
              >
                <span className="w-8 h-8 flex items-center justify-center bg-app-accent/20 text-app-accent rounded-full text-sm font-medium flex-shrink-0">
                  {index}
                </span>
                <div className="flex-1 min-w-0">
                  <Link
                    to={`/person/${dbId}/${person.id}`}
                    className="font-medium text-app-accent hover:underline break-words"
                  >
                    {person.name}
                  </Link>
                  {person.externalId && (
                    <span className="text-app-text-subtle ml-2 text-xs sm:text-sm">({person.externalId})</span>
                  )}
                  <p className="text-xs sm:text-sm text-app-text-muted break-words">
                    {person.lifespan}
                    {person.location && ` • ${person.location}`}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
