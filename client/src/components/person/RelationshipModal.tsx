import { useState, useEffect, useRef, useCallback } from 'react';
import { X, Loader2, Search, UserPlus, Users, Heart, User } from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '../../services/api';
import type { RelationshipType } from '../../types/relationship';

interface RelationshipModalProps {
  open: boolean;
  dbId: string;
  personId: string;
  initialType?: RelationshipType;
  onClose: () => void;
  onLinked: () => void | Promise<void>;
}

interface QuickSearchResult {
  personId: string;
  displayName: string;
  gender: string;
  birthName: string | null;
  birthYear: number | null;
}

const TYPE_CONFIG: Record<RelationshipType, { label: string; icon: typeof Users }> = {
  father: { label: 'Father', icon: User },
  mother: { label: 'Mother', icon: User },
  spouse: { label: 'Spouse', icon: Heart },
  child: { label: 'Child', icon: Users },
};

export function RelationshipModal({ open, dbId, personId, initialType, onClose, onLinked }: RelationshipModalProps) {
  const [relType, setRelType] = useState<RelationshipType>(initialType ?? 'spouse');
  const [mode, setMode] = useState<'search' | 'create'>('search');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<QuickSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newGender, setNewGender] = useState<'male' | 'female' | 'unknown'>('unknown');
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  // Monotonically increasing request id so out-of-order responses from
  // earlier searches don't overwrite results from a newer search.
  const searchRequestIdRef = useRef(0);

  useEffect(() => {
    if (open) {
      setRelType(initialType ?? 'spouse');
      setMode('search');
      setQuery('');
      setResults([]);
      setSearching(false);
      setLinkingId(null);
      setNewName('');
      setNewGender('unknown');
      // Invalidate any in-flight requests from a previous open
      searchRequestIdRef.current += 1;
      setTimeout(() => inputRef.current?.focus(), 100);
    } else {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      searchRequestIdRef.current += 1;
    }
  }, [open, initialType]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  useEffect(() => {
    if (relType === 'father') setNewGender('male');
    else if (relType === 'mother') setNewGender('female');
    else setNewGender('unknown');
  }, [relType]);

  const doSearch = useCallback(async (q: string) => {
    if (q.length < 2) {
      // Invalidate any in-flight search so a late >=2-char response cannot
      // repopulate results after the user has deleted back to <2 chars.
      searchRequestIdRef.current += 1;
      setResults([]);
      setSearching(false);
      return;
    }
    const requestId = ++searchRequestIdRef.current;
    setSearching(true);
    try {
      const data = await api.quickSearchPersons(dbId, q);
      // Drop the response if a newer search has been issued in the meantime
      if (requestId !== searchRequestIdRef.current) return;
      setResults(data.filter(r => r.personId !== personId));
    } catch (error) {
      if (requestId !== searchRequestIdRef.current) return;
      console.error('Failed to search persons', error);
      toast.error('Failed to search persons. Please try again.');
    } finally {
      // Only clear the spinner for the latest request — earlier requests
      // resolving late must not flip it off while a newer one is still active
      if (requestId === searchRequestIdRef.current) {
        setSearching(false);
      }
    }
  }, [dbId, personId]);

  const handleQueryChange = (value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(value), 300);
  };

  const handleLinkExisting = async (targetId: string) => {
    setLinkingId(targetId);
    const result = await api.linkRelationship(dbId, personId, relType, targetId).catch(err => {
      toast.error(err.message || 'Failed to link');
      return null;
    });
    setLinkingId(null);
    if (!result) return;
    await onLinked();
    onClose();
  };

  const handleCreateNew = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setLinkingId('new');
    const result = await api.linkRelationship(dbId, personId, relType, undefined, { name: newName.trim(), gender: newGender }).catch(err => {
      toast.error(err.message || 'Failed to create');
      return null;
    });
    setLinkingId(null);
    if (!result) return;
    await onLinked();
    onClose();
  };

  if (!open) return null;

  const linking = linkingId !== null;
  // Block close interactions while a link/create request is in flight so we
  // can't unmount mid-await and run setState/onLinked on a dead component.
  const safeClose = () => {
    if (linking) return;
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => e.target === e.currentTarget && safeClose()}
    >
      <div className="bg-app-card rounded-lg border border-app-border shadow-xl max-w-lg w-full mx-4 max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-app-border shrink-0">
          <div className="flex items-center gap-2">
            <UserPlus size={16} className="text-app-accent" />
            <h3 className="font-semibold text-app-text">Add Relationship</h3>
          </div>
          <button
            onClick={safeClose}
            disabled={linking}
            className="p-1 text-app-text-muted hover:text-app-text hover:bg-app-hover rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-4 pt-3 shrink-0">
          <div className="flex gap-1.5">
            {(Object.keys(TYPE_CONFIG) as RelationshipType[]).map(type => {
              const cfg = TYPE_CONFIG[type];
              const Icon = cfg.icon;
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => setRelType(type)}
                  className={`flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-md transition-colors ${
                    relType === type
                      ? 'bg-app-accent/20 text-app-accent border border-app-accent/40'
                      : 'bg-app-bg text-app-text-muted border border-app-border hover:bg-app-hover'
                  }`}
                >
                  <Icon size={12} />
                  {cfg.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="px-4 pt-3 shrink-0">
          <div className="flex gap-2 border-b border-app-border">
            <button
              type="button"
              onClick={() => setMode('search')}
              className={`pb-2 px-1 text-sm transition-colors ${
                mode === 'search'
                  ? 'text-app-accent border-b-2 border-app-accent'
                  : 'text-app-text-muted hover:text-app-text'
              }`}
            >
              <span className="flex items-center gap-1"><Search size={12} /> Link Existing</span>
            </button>
            <button
              type="button"
              onClick={() => setMode('create')}
              className={`pb-2 px-1 text-sm transition-colors ${
                mode === 'create'
                  ? 'text-app-accent border-b-2 border-app-accent'
                  : 'text-app-text-muted hover:text-app-text'
              }`}
            >
              <span className="flex items-center gap-1"><UserPlus size={12} /> Create New</span>
            </button>
          </div>
        </div>

        <div className="p-4 overflow-y-auto flex-1 min-h-0">
          {mode === 'search' ? (
            <div className="space-y-3">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-app-text-muted" />
                <input
                  ref={inputRef}
                  type="text"
                  value={query}
                  onChange={(e) => handleQueryChange(e.target.value)}
                  placeholder="Search by name..."
                  className="w-full pl-8 pr-3 py-2 bg-app-bg border border-app-border rounded text-app-text text-sm focus:outline-none focus:ring-2 focus:ring-app-accent"
                  disabled={linking}
                />
                {searching && <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-app-text-muted" />}
              </div>

              {results.length > 0 && (
                <div className="space-y-1 max-h-[300px] overflow-y-auto">
                  {results.map(r => (
                    <button
                      key={r.personId}
                      type="button"
                      onClick={() => handleLinkExisting(r.personId)}
                      disabled={linking}
                      className="w-full flex items-center gap-3 px-3 py-2 rounded hover:bg-app-hover transition-colors text-left disabled:opacity-50"
                    >
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs shrink-0 ${
                        r.gender === 'male' ? 'bg-blue-500/20 text-blue-400' :
                        r.gender === 'female' ? 'bg-pink-500/20 text-pink-400' :
                        'bg-gray-500/20 text-gray-400'
                      }`}>
                        {r.gender === 'male' ? '♂' : r.gender === 'female' ? '♀' : '?'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-app-text truncate">{r.displayName}</div>
                        <div className="text-xs text-app-text-muted truncate">
                          {r.birthName && r.birthName !== r.displayName ? `Born: ${r.birthName}` : ''}
                          {r.birthYear ? `${r.birthName && r.birthName !== r.displayName ? ' · ' : ''}b. ${r.birthYear}` : ''}
                          {!r.birthName && !r.birthYear ? r.personId.slice(0, 8) + '...' : ''}
                        </div>
                      </div>
                      {linkingId === r.personId && <Loader2 size={14} className="animate-spin text-app-text-muted shrink-0" />}
                    </button>
                  ))}
                </div>
              )}

              {query.length >= 2 && !searching && results.length === 0 && (
                <p className="text-xs text-app-text-subtle text-center py-4">
                  No matching people found.{' '}
                  <button type="button" onClick={() => { setMode('create'); setNewName(query); }} className="text-app-accent hover:underline">
                    Create a new person?
                  </button>
                </p>
              )}

              {query.length < 2 && (
                <p className="text-xs text-app-text-subtle text-center py-4">
                  Type at least 2 characters to search
                </p>
              )}
            </div>
          ) : (
            <form onSubmit={handleCreateNew} className="space-y-3">
              <div>
                <label className="block text-xs text-app-text-muted mb-1">Full Name</label>
                <input
                  ref={mode === 'create' ? inputRef : undefined}
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. John Smith"
                  className="w-full px-3 py-2 bg-app-bg border border-app-border rounded text-app-text text-sm focus:outline-none focus:ring-2 focus:ring-app-accent"
                  disabled={linking}
                />
              </div>

              <div>
                <label className="block text-xs text-app-text-muted mb-1">Gender</label>
                <div className="flex gap-2">
                  {(['male', 'female', 'unknown'] as const).map(g => (
                    <button
                      key={g}
                      type="button"
                      onClick={() => setNewGender(g)}
                      className={`flex-1 py-1.5 text-xs rounded transition-colors ${
                        newGender === g
                          ? g === 'male' ? 'bg-blue-500/20 text-blue-400 border border-blue-500/40'
                            : g === 'female' ? 'bg-pink-500/20 text-pink-400 border border-pink-500/40'
                            : 'bg-gray-500/20 text-gray-400 border border-gray-500/40'
                          : 'bg-app-bg text-app-text-muted border border-app-border hover:bg-app-hover'
                      }`}
                    >
                      {g === 'male' ? '♂ Male' : g === 'female' ? '♀ Female' : '? Unknown'}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={linking}
                  className="px-3 py-1.5 text-sm text-app-text-secondary hover:bg-app-hover rounded transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={linking || !newName.trim()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded bg-app-accent/20 text-app-accent hover:opacity-80 disabled:opacity-50 transition-colors"
                >
                  {linkingId === 'new' ? (
                    <><Loader2 size={14} className="animate-spin" /> Creating...</>
                  ) : (
                    <><UserPlus size={14} /> Create & Link</>
                  )}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
