import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ChevronDown, ChevronUp, Sparkles } from 'lucide-react';
import type { PersonWithId, SearchParams } from '@fsf/shared';
import { api } from '../../services/api';
import { AiDiscoveryModal } from '../ai/AiDiscoveryModal';

export function SearchPage() {
  const { dbId } = useParams<{ dbId: string }>();
  const [query, setQuery] = useState('');
  const [location, setLocation] = useState('');
  const [occupation, setOccupation] = useState('');
  const [birthAfter, setBirthAfter] = useState('');
  const [birthBefore, setBirthBefore] = useState('');
  const [generationMin, setGenerationMin] = useState('');
  const [generationMax, setGenerationMax] = useState('');
  const [hasPhoto, setHasPhoto] = useState(false);
  const [hasBio, setHasBio] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showAiModal, setShowAiModal] = useState(false);
  const [results, setResults] = useState<PersonWithId[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const handleSearch = async (newPage = 1) => {
    if (!dbId) return;

    setLoading(true);
    setPage(newPage);

    const params: SearchParams = {
      q: query || undefined,
      location: location || undefined,
      occupation: occupation || undefined,
      birthAfter: birthAfter || undefined,
      birthBefore: birthBefore || undefined,
      generationMin: generationMin ? parseInt(generationMin) : undefined,
      generationMax: generationMax ? parseInt(generationMax) : undefined,
      hasPhoto: hasPhoto || undefined,
      hasBio: hasBio || undefined,
      page: newPage,
      limit: 50
    };

    const result = await api.search(dbId, params).catch(() => null);

    if (result) {
      setResults(result.results);
      setTotal(result.total);
    }

    setLoading(false);
    setSearched(true);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch();
  };

  const hasActiveFilters = birthAfter || birthBefore || generationMin || generationMax || hasPhoto || hasBio;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-app-text">Search</h1>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowAiModal(true)}
            className="flex items-center gap-2 px-3 py-1.5 bg-app-accent/10 text-app-accent border border-app-accent/30 rounded-md hover:bg-app-accent/20 transition-colors"
          >
            <Sparkles size={16} />
            AI Discovery
          </button>
          <Link to={`/tree/${dbId}`} className="text-app-accent hover:underline">
            Back to tree
          </Link>
        </div>
      </div>

      <div className="bg-app-card rounded-lg border border-app-border p-4 mb-6">
        {/* Main search row */}
        <div className="grid gap-4 md:grid-cols-4">
          <input
            type="text"
            placeholder="Name, bio, or occupation..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="px-3 py-2 border border-app-border rounded-md bg-app-bg text-app-text"
            onKeyDown={handleKeyDown}
          />
          <input
            type="text"
            placeholder="Location..."
            value={location}
            onChange={e => setLocation(e.target.value)}
            className="px-3 py-2 border border-app-border rounded-md bg-app-bg text-app-text"
            onKeyDown={handleKeyDown}
          />
          <input
            type="text"
            placeholder="Occupation..."
            value={occupation}
            onChange={e => setOccupation(e.target.value)}
            className="px-3 py-2 border border-app-border rounded-md bg-app-bg text-app-text"
            onKeyDown={handleKeyDown}
          />
          <button
            onClick={() => handleSearch()}
            disabled={loading}
            className="px-4 py-2 bg-app-accent text-white rounded-md hover:bg-app-accent-hover disabled:opacity-50"
          >
            {loading ? 'Searching...' : 'Search'}
          </button>
        </div>

        {/* Advanced filters toggle */}
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="flex items-center gap-1 mt-3 text-sm text-app-text-muted hover:text-app-text transition-colors"
        >
          {showAdvanced ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          Advanced Filters
          {hasActiveFilters && <span className="ml-1 w-2 h-2 bg-app-accent rounded-full" />}
        </button>

        {/* Advanced filters panel */}
        {showAdvanced && (
          <div className="mt-4 pt-4 border-t border-app-border">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              {/* Birth year range */}
              <div>
                <label className="block text-xs text-app-text-muted mb-1">Birth Year Range</label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="From"
                    value={birthAfter}
                    onChange={e => setBirthAfter(e.target.value)}
                    className="w-full px-2 py-1.5 text-sm border border-app-border rounded bg-app-bg text-app-text"
                    onKeyDown={handleKeyDown}
                  />
                  <span className="text-app-text-muted">-</span>
                  <input
                    type="text"
                    placeholder="To"
                    value={birthBefore}
                    onChange={e => setBirthBefore(e.target.value)}
                    className="w-full px-2 py-1.5 text-sm border border-app-border rounded bg-app-bg text-app-text"
                    onKeyDown={handleKeyDown}
                  />
                </div>
              </div>

              {/* Generation range */}
              <div>
                <label className="block text-xs text-app-text-muted mb-1">Generations Away</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    placeholder="Min"
                    min="0"
                    value={generationMin}
                    onChange={e => setGenerationMin(e.target.value)}
                    className="w-full px-2 py-1.5 text-sm border border-app-border rounded bg-app-bg text-app-text"
                    onKeyDown={handleKeyDown}
                  />
                  <span className="text-app-text-muted">-</span>
                  <input
                    type="number"
                    placeholder="Max"
                    min="0"
                    value={generationMax}
                    onChange={e => setGenerationMax(e.target.value)}
                    className="w-full px-2 py-1.5 text-sm border border-app-border rounded bg-app-bg text-app-text"
                    onKeyDown={handleKeyDown}
                  />
                </div>
              </div>

              {/* Checkboxes */}
              <div className="flex flex-col justify-center gap-2">
                <label className="flex items-center gap-2 text-sm text-app-text cursor-pointer">
                  <input
                    type="checkbox"
                    checked={hasPhoto}
                    onChange={e => setHasPhoto(e.target.checked)}
                    className="rounded border-app-border"
                  />
                  Has photo
                </label>
                <label className="flex items-center gap-2 text-sm text-app-text cursor-pointer">
                  <input
                    type="checkbox"
                    checked={hasBio}
                    onChange={e => setHasBio(e.target.checked)}
                    className="rounded border-app-border"
                  />
                  Has bio
                </label>
              </div>

              {/* Clear filters button */}
              <div className="flex items-end">
                {hasActiveFilters && (
                  <button
                    onClick={() => {
                      setBirthAfter('');
                      setBirthBefore('');
                      setGenerationMin('');
                      setGenerationMax('');
                      setHasPhoto(false);
                      setHasBio(false);
                    }}
                    className="text-sm text-app-text-muted hover:text-app-text underline"
                  >
                    Clear filters
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {searched && (
        <div>
          <p className="text-app-text-muted mb-4">
            Found {total.toLocaleString()} results
          </p>

          {results.length > 0 ? (
            <div className="bg-app-card rounded-lg border border-app-border overflow-hidden">
              <table className="w-full">
                <thead className="bg-app-bg">
                  <tr>
                    <th className="px-4 py-3 text-left text-sm font-medium text-app-text-secondary">Name</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-app-text-secondary">Lifespan</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-app-text-secondary">Location</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-app-text-secondary">Occupation</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-app-border">
                  {results.map(person => (
                    <tr key={person.id} className="hover:bg-app-border/50">
                      <td className="px-4 py-3">
                        <Link
                          to={`/person/${dbId}/${person.id}`}
                          className="text-app-accent hover:underline"
                        >
                          {person.name}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-app-text-muted">{person.lifespan}</td>
                      <td className="px-4 py-3 text-app-text-muted">{person.location || '-'}</td>
                      <td className="px-4 py-3 text-app-text-muted">{person.occupation || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-app-text-subtle text-center py-8">No results found</p>
          )}

          {total > 50 && (
            <div className="flex justify-center gap-2 mt-4">
              <button
                onClick={() => handleSearch(page - 1)}
                disabled={page === 1 || loading}
                className="px-3 py-1 border border-app-border rounded text-app-text-secondary disabled:opacity-50 hover:bg-app-border"
              >
                Previous
              </button>
              <span className="px-3 py-1 text-app-text-muted">
                Page {page} of {Math.ceil(total / 50)}
              </span>
              <button
                onClick={() => handleSearch(page + 1)}
                disabled={page >= Math.ceil(total / 50) || loading}
                className="px-3 py-1 border border-app-border rounded text-app-text-secondary disabled:opacity-50 hover:bg-app-border"
              >
                Next
              </button>
            </div>
          )}
        </div>
      )}

      {/* AI Discovery Modal */}
      {showAiModal && dbId && (
        <AiDiscoveryModal
          dbId={dbId}
          onClose={() => setShowAiModal(false)}
          onComplete={() => {
            // Optionally refresh or navigate somewhere after adding favorites
          }}
        />
      )}
    </div>
  );
}
