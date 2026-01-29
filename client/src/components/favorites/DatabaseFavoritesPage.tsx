import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Star, User, Search, Filter, X, Network, Loader2, Database, Sparkles } from 'lucide-react';
import { api } from '../../services/api';
import type { FavoriteWithPerson, DatabaseInfo } from '@fsf/shared';
import { AiDiscoveryModal } from '../ai/AiDiscoveryModal';

export function DatabaseFavoritesPage() {
  const { dbId } = useParams<{ dbId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [favorites, setFavorites] = useState<FavoriteWithPerson[]>([]);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [database, setDatabase] = useState<DatabaseInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [showDiscoveryModal, setShowDiscoveryModal] = useState(false);

  // Filters
  const searchQuery = searchParams.get('q') || '';
  const selectedTag = searchParams.get('tag') || '';

  const loadFavorites = () => {
    if (!dbId) return;

    setLoading(true);
    Promise.all([
      api.listDbFavorites(dbId, page, 50),
      api.getDatabase(dbId),
    ])
      .then(([favoritesData, dbData]) => {
        setFavorites(favoritesData.favorites);
        setTotal(favoritesData.total);
        setTotalPages(favoritesData.totalPages);
        setAllTags(favoritesData.allTags);
        setDatabase(dbData);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadFavorites();
  }, [dbId, page]);

  // Apply filters
  const filteredFavorites = favorites.filter(fav => {
    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      const matchesName = fav.name.toLowerCase().includes(query);
      const matchesWhy = fav.favorite.whyInteresting.toLowerCase().includes(query);
      if (!matchesName && !matchesWhy) return false;
    }

    // Tag filter
    if (selectedTag && !fav.favorite.tags.includes(selectedTag)) {
      return false;
    }

    return true;
  });

  const updateFilter = (key: string, value: string) => {
    const newParams = new URLSearchParams(searchParams);
    if (value) {
      newParams.set(key, value);
    } else {
      newParams.delete(key);
    }
    setSearchParams(newParams);
  };

  const clearFilters = () => {
    setSearchParams({});
  };

  const hasFilters = searchQuery || selectedTag;

  if (!dbId) {
    return (
      <div className="text-center py-16 p-6">
        <p className="text-app-error">No database selected</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 p-6">
        <Loader2 size={32} className="animate-spin text-app-accent" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Star size={28} className="text-yellow-400 fill-current" />
          <div>
            <h1 className="text-2xl font-bold text-app-text">Favorites</h1>
            <div className="flex items-center gap-2 text-sm text-app-text-muted">
              <Database size={14} />
              <span>{database?.rootName || dbId}</span>
              <span className="text-app-text-subtle">•</span>
              <span>{total} favorites</span>
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowDiscoveryModal(true)}
            className="px-3 py-1.5 bg-purple-600 text-white rounded hover:bg-purple-700 text-sm flex items-center gap-1"
          >
            <Sparkles size={14} />
            AI Discovery
          </button>
          <Link
            to="/favorites"
            className="px-3 py-1.5 bg-app-border text-app-text-secondary rounded hover:bg-app-hover text-sm"
          >
            All Favorites
          </Link>
          {total > 0 && (
            <Link
              to={`/favorites/sparse-tree/${dbId}`}
              className="px-3 py-1.5 bg-app-accent text-app-text rounded hover:bg-app-accent/80 text-sm flex items-center gap-1"
            >
              <Network size={14} />
              Sparse Tree
            </Link>
          )}
        </div>
      </div>

      {/* Filters bar */}
      <div className="bg-app-card border border-app-border rounded-lg p-4">
        <div className="flex flex-wrap gap-4">
          {/* Search */}
          <div className="relative flex-1 min-w-[200px]">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-app-text-subtle" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => updateFilter('q', e.target.value)}
              placeholder="Search favorites..."
              className="w-full pl-9 pr-3 py-2 bg-app-bg border border-app-border rounded text-app-text placeholder-app-placeholder focus:border-app-accent focus:outline-none"
            />
          </div>

          {/* Tag filter */}
          {allTags.length > 0 && (
            <div className="relative">
              <Filter size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-app-text-subtle" />
              <select
                value={selectedTag}
                onChange={e => updateFilter('tag', e.target.value)}
                className="pl-9 pr-8 py-2 bg-app-bg border border-app-border rounded text-app-text focus:border-app-accent focus:outline-none appearance-none cursor-pointer"
              >
                <option value="">All Tags</option>
                {allTags.map(tag => (
                  <option key={tag} value={tag}>{tag}</option>
                ))}
              </select>
            </div>
          )}

          {/* Clear filters */}
          {hasFilters && (
            <button
              onClick={clearFilters}
              className="flex items-center gap-1 px-3 py-2 text-app-text-muted hover:text-app-text transition-colors"
            >
              <X size={16} />
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Results */}
      {filteredFavorites.length === 0 ? (
        <div className="text-center py-16">
          <Star size={48} className="mx-auto text-app-text-subtle mb-4" />
          <h3 className="text-lg font-medium text-app-text-muted mb-2">
            {hasFilters ? 'No favorites match your filters' : 'No favorites in this database'}
          </h3>
          <p className="text-app-text-subtle mb-4">
            {hasFilters
              ? 'Try adjusting your search or filters'
              : 'Mark people as favorites from their detail pages'
            }
          </p>
          {!hasFilters && (
            <Link
              to={`/search/${dbId}`}
              className="text-app-accent hover:underline"
            >
              Search the database
            </Link>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredFavorites.map(fav => (
            <FavoriteCard key={fav.personId} favorite={fav} dbId={dbId} />
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center gap-2">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-3 py-1 bg-app-border text-app-text-secondary rounded hover:bg-app-hover disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Previous
          </button>
          <span className="px-3 py-1 text-app-text-muted">
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="px-3 py-1 bg-app-border text-app-text-secondary rounded hover:bg-app-hover disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Next
          </button>
        </div>
      )}

      {/* AI Discovery Modal */}
      {showDiscoveryModal && (
        <AiDiscoveryModal
          dbId={dbId}
          onClose={() => setShowDiscoveryModal(false)}
          onComplete={loadFavorites}
        />
      )}
    </div>
  );
}

interface FavoriteCardProps {
  favorite: FavoriteWithPerson;
  dbId: string;
}

function FavoriteCard({ favorite, dbId }: FavoriteCardProps) {
  const { personId, name, lifespan, photoUrl, favorite: favData } = favorite;
  const personLink = `/person/${dbId}/${personId}`;

  return (
    <Link
      to={personLink}
      className="bg-app-card border border-app-border rounded-lg p-4 hover:border-app-accent transition-colors group"
    >
      <div className="flex gap-4">
        {/* Photo */}
        <div className="flex-shrink-0">
          {photoUrl ? (
            <img
              src={photoUrl}
              alt={name}
              className="w-16 h-16 rounded-lg object-cover border border-app-border"
            />
          ) : (
            <div className="w-16 h-16 rounded-lg bg-app-bg border border-app-border flex items-center justify-center">
              <User size={24} className="text-app-text-subtle" />
            </div>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Star size={14} className="text-yellow-400 fill-current flex-shrink-0" />
            <h3 className="text-app-text font-medium truncate group-hover:text-app-accent transition-colors">
              {name}
            </h3>
          </div>
          <p className="text-sm text-app-text-muted mb-2">{lifespan}</p>

          {/* Why interesting - truncated */}
          <p className="text-xs text-app-text-subtle line-clamp-2">
            {favData.whyInteresting}
          </p>
        </div>
      </div>

      {/* Tags */}
      {favData.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-3">
          {favData.tags.map(tag => (
            <span
              key={tag}
              className="px-2 py-0.5 bg-app-accent/10 text-app-accent rounded text-xs"
            >
              {tag}
            </span>
          ))}
        </div>
      )}
    </Link>
  );
}
