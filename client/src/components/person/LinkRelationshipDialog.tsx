import { useState, useEffect, useRef, useCallback } from 'react';
import { X, Loader2, Search, UserPlus, Users, Heart, User } from 'lucide-react';
import type { PersonWithId } from '@fsf/shared';
import { api } from '../../services/api';

export type RelationshipType = 'parent' | 'spouse' | 'child';

interface LinkRelationshipDialogProps {
  open: boolean;
  dbId: string;
  personId: string;
  defaultType?: RelationshipType;
  onClose: () => void;
  onLinked: () => void;
}

const TYPE_CONFIG: Record<RelationshipType, { icon: typeof Users; label: string; color: string }> = {
  parent: { icon: Users, label: 'Parent', color: 'text-sky-400' },
  spouse: { icon: Heart, label: 'Spouse', color: 'text-rose-400' },
  child: { icon: User, label: 'Child', color: 'text-emerald-400' },
};

export function LinkRelationshipDialog({ open, dbId, personId, defaultType, onClose, onLinked }: LinkRelationshipDialogProps) {
  const [type, setType] = useState<RelationshipType>(defaultType || 'parent');
  const [role, setRole] = useState<'father' | 'mother'>('father');
  const [mode, setMode] = useState<'search' | 'create'>('search');

  // Search state
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PersonWithId[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Create state
  const [newName, setNewName] = useState('');
  const [newGender, setNewGender] = useState<'male' | 'female' | 'unknown'>('unknown');

  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (open) {
      setType(defaultType || 'parent');
      setRole('father');
      setMode('search');
      setQuery('');
      setResults([]);
      setSelectedId(null);
      setNewName('');
      setNewGender('unknown');
      setSaving(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open, defaultType]);

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current); };
  }, []);

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim() || q.trim().length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    const result = await api.search(dbId, { q: q.trim(), limit: 10 });
    // Filter out the current person from results
    setResults(result.results.filter(p => p.id !== personId));
    setSearching(false);
  }, [dbId, personId]);

  const handleQueryChange = (value: string) => {
    setQuery(value);
    setSelectedId(null);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => doSearch(value), 300);
  };

  const handleSubmit = async () => {
    if (saving) return;
    setSaving(true);

    const data: Parameters<typeof api.addRelationship>[2] = {
      type,
      ...(type === 'parent' ? { role } : {}),
    };

    if (mode === 'search' && selectedId) {
      data.targetId = selectedId;
    } else if (mode === 'create' && newName.trim()) {
      const effectiveGender = type === 'parent' ? (role === 'father' ? 'male' : 'female') : newGender;
      data.create = { name: newName.trim(), gender: effectiveGender };
    } else {
      setSaving(false);
      return;
    }

    await api.addRelationship(dbId, personId, data);
    setSaving(false);
    onLinked();
    onClose();
  };

  if (!open) return null;

  const canSubmit = mode === 'search' ? !!selectedId : !!newName.trim();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-app-card rounded-lg border border-app-border shadow-xl max-w-lg w-full mx-4 max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-app-border shrink-0">
          <div className="flex items-center gap-2">
            <UserPlus size={16} className="text-app-accent" />
            <h3 className="font-semibold text-app-text">Add Relationship</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-app-text-muted hover:text-app-text hover:bg-app-hover rounded transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 space-y-4 overflow-y-auto flex-1">
          {/* Relationship type selector */}
          <div className="flex gap-2">
            {(Object.keys(TYPE_CONFIG) as RelationshipType[]).map((t) => {
              const cfg = TYPE_CONFIG[t];
              const Icon = cfg.icon;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => { setType(t); setSelectedId(null); }}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded border transition-colors ${
                    type === t
                      ? 'border-app-accent bg-app-accent/10 text-app-accent'
                      : 'border-app-border text-app-text-muted hover:bg-app-hover'
                  }`}
                >
                  <Icon size={14} />
                  {cfg.label}
                </button>
              );
            })}
          </div>

          {/* Parent role (only for parent type) */}
          {type === 'parent' && (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setRole('father')}
                className={`px-3 py-1 text-sm rounded border transition-colors ${
                  role === 'father'
                    ? 'border-sky-500 bg-sky-500/10 text-sky-400'
                    : 'border-app-border text-app-text-muted hover:bg-app-hover'
                }`}
              >
                Father
              </button>
              <button
                type="button"
                onClick={() => setRole('mother')}
                className={`px-3 py-1 text-sm rounded border transition-colors ${
                  role === 'mother'
                    ? 'border-pink-500 bg-pink-500/10 text-pink-400'
                    : 'border-app-border text-app-text-muted hover:bg-app-hover'
                }`}
              >
                Mother
              </button>
            </div>
          )}

          {/* Mode toggle: search vs create */}
          <div className="flex gap-2 border-b border-app-border pb-2">
            <button
              type="button"
              onClick={() => setMode('search')}
              className={`flex items-center gap-1.5 px-3 py-1 text-sm transition-colors ${
                mode === 'search'
                  ? 'text-app-accent border-b-2 border-app-accent -mb-[9px] pb-[7px]'
                  : 'text-app-text-muted hover:text-app-text'
              }`}
            >
              <Search size={14} />
              Link Existing
            </button>
            <button
              type="button"
              onClick={() => setMode('create')}
              className={`flex items-center gap-1.5 px-3 py-1 text-sm transition-colors ${
                mode === 'create'
                  ? 'text-app-accent border-b-2 border-app-accent -mb-[9px] pb-[7px]'
                  : 'text-app-text-muted hover:text-app-text'
              }`}
            >
              <UserPlus size={14} />
              Create New
            </button>
          </div>

          {/* Search mode */}
          {mode === 'search' && (
            <div className="space-y-2">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-app-text-muted" />
                <input
                  ref={inputRef}
                  type="text"
                  value={query}
                  onChange={(e) => handleQueryChange(e.target.value)}
                  placeholder="Search by name..."
                  className="w-full pl-8 pr-3 py-2 bg-app-bg border border-app-border rounded text-app-text text-sm focus:outline-none focus:ring-2 focus:ring-app-accent"
                />
                {searching && <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-app-text-muted" />}
              </div>

              {/* Results */}
              {results.length > 0 && (
                <div className="max-h-48 overflow-y-auto border border-app-border rounded divide-y divide-app-border/50">
                  {results.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setSelectedId(p.id === selectedId ? null : p.id)}
                      className={`w-full flex items-center gap-3 px-3 py-2 text-left text-sm transition-colors ${
                        p.id === selectedId
                          ? 'bg-app-accent/10 text-app-accent'
                          : 'text-app-text hover:bg-app-hover'
                      }`}
                    >
                      <div className="w-6 h-6 rounded-full bg-app-border flex items-center justify-center shrink-0">
                        <User size={12} className="text-app-text-muted" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-medium truncate">{p.name}</div>
                        {p.lifespan && (
                          <div className="text-xs text-app-text-subtle">{p.lifespan}</div>
                        )}
                      </div>
                      {p.gender && (
                        <span className="text-xs text-app-text-muted">
                          {p.gender === 'male' ? '♂' : p.gender === 'female' ? '♀' : ''}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}

              {query.trim().length >= 2 && !searching && results.length === 0 && (
                <p className="text-xs text-app-text-subtle text-center py-2">
                  No results found. Try a different name or create a new person.
                </p>
              )}
            </div>
          )}

          {/* Create mode */}
          {mode === 'create' && (
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-app-text-muted mb-1">Full Name</label>
                <input
                  ref={mode === 'create' ? inputRef : undefined}
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. John Smith"
                  className="w-full px-3 py-2 bg-app-bg border border-app-border rounded text-app-text text-sm focus:outline-none focus:ring-2 focus:ring-app-accent"
                />
              </div>
              {type !== 'parent' && (
              <div>
                <label className="block text-xs text-app-text-muted mb-1">Gender</label>
                <div className="flex gap-2">
                  {(['male', 'female', 'unknown'] as const).map((g) => (
                    <button
                      key={g}
                      type="button"
                      onClick={() => setNewGender(g)}
                      className={`px-3 py-1 text-sm rounded border transition-colors capitalize ${
                        newGender === g
                          ? 'border-app-accent bg-app-accent/10 text-app-accent'
                          : 'border-app-border text-app-text-muted hover:bg-app-hover'
                      }`}
                    >
                      {g === 'male' ? '\u2642 Male' : g === 'female' ? '\u2640 Female' : 'Unknown'}
                    </button>
                  ))}
                </div>
              </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-app-border shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="px-3 py-1.5 text-sm text-app-text-secondary hover:bg-app-hover rounded transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={saving || !canSubmit}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded bg-app-accent/10 text-app-accent hover:bg-app-accent/20 disabled:opacity-50 transition-colors"
          >
            {saving ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <UserPlus size={14} />
                {mode === 'search' ? 'Link' : 'Create & Link'}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
