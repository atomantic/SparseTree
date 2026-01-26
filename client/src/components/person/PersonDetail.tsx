import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { Briefcase, Users, ExternalLink, GitBranch, Loader2, User, BookOpen, Heart, TreeDeciduous, Calendar, MapPin, Check, X, Copy } from 'lucide-react';
import toast from 'react-hot-toast';
import type { PersonWithId, PathResult, DatabaseInfo, PersonAugmentation } from '@fsf/shared';
import { api, LegacyScrapedPersonData, PersonOverrides, PersonClaim } from '../../services/api';
import { FavoriteButton } from '../favorites/FavoriteButton';
import { useSidebar } from '../../context/SidebarContext';
import { EditableField } from '../ui/EditableField';
import { EditableDate } from '../ui/EditableDate';
import type { ListItem } from '../ui/EditableList';
import type { VitalEventOverrides } from './VitalEventCard';
import { UploadToFamilySearchDialog } from './UploadToFamilySearchDialog';
import { ProviderDataTable } from './ProviderDataTable';
import { LinkPlatformDialog } from './LinkPlatformDialog';

interface CachedLineage {
  path: PathResult;
  timestamp: number;
}

function getLineageCacheKey(dbId: string, personId: string): string {
  return `fsf-lineage-${dbId}-${personId}`;
}

function getCachedLineage(dbId: string, personId: string): PathResult | null {
  const key = getLineageCacheKey(dbId, personId);
  const cached = localStorage.getItem(key);
  if (!cached) return null;

  const data: CachedLineage = JSON.parse(cached);
  // Cache for 24 hours
  if (Date.now() - data.timestamp > 24 * 60 * 60 * 1000) {
    localStorage.removeItem(key);
    return null;
  }
  return data.path;
}

function setCachedLineage(dbId: string, personId: string, path: PathResult): void {
  const key = getLineageCacheKey(dbId, personId);
  const data: CachedLineage = { path, timestamp: Date.now() };
  localStorage.setItem(key, JSON.stringify(data));
}

function getRelationshipLabel(generations: number): string {
  if (generations === 0) return 'Self';
  if (generations === 1) return 'Parent';
  if (generations === 2) return 'Grandparent';
  if (generations === 3) return 'Great-Grandparent';

  // 4+ generations: 2nd great, 3rd great, etc.
  const greats = generations - 2;
  const ordinal = getOrdinal(greats);
  return `${ordinal} Great-Grandparent`;
}

function getOrdinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function InlineAddInput({ onAdd, onCancel, placeholder }: { onAdd: (value: string) => void; onCancel: () => void; placeholder: string }) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const handleSubmit = () => {
    if (value.trim()) {
      onAdd(value.trim());
    }
  };

  return (
    <div className="flex items-center gap-1 mt-1.5">
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleSubmit();
          if (e.key === 'Escape') onCancel();
        }}
        placeholder={placeholder}
        className="flex-1 px-2 py-0.5 bg-app-bg border border-app-accent rounded text-app-text text-xs focus:outline-none focus:ring-1 focus:ring-app-accent"
      />
      <button onClick={handleSubmit} className="p-0.5 text-app-success hover:bg-app-success/10 rounded" title="Add">
        <Check size={14} />
      </button>
      <button onClick={onCancel} className="p-0.5 text-app-error hover:bg-app-error/10 rounded" title="Cancel">
        <X size={14} />
      </button>
    </div>
  );
}

export function PersonDetail() {
  const { dbId, personId } = useParams<{ dbId: string; personId: string }>();
  const navigate = useNavigate();
  const { refreshDatabases, expandDatabase } = useSidebar();
  const [person, setPerson] = useState<PersonWithId | null>(null);
  const [parentData, setParentData] = useState<Record<string, PersonWithId>>({});
  const [spouseData, setSpouseData] = useState<Record<string, PersonWithId>>({});
  const [database, setDatabase] = useState<DatabaseInfo | null>(null);
  const [lineage, setLineage] = useState<PathResult | null>(null);
  const [, setScrapedData] = useState<LegacyScrapedPersonData | null>(null);
  const [augmentation, setAugmentation] = useState<PersonAugmentation | null>(null);
  const [hasPhoto, setHasPhoto] = useState(false);
  const [hasFsPhoto, setHasFsPhoto] = useState(false);
  const [hasWikiPhoto, setHasWikiPhoto] = useState(false);
  const [hasAncestryPhoto, setHasAncestryPhoto] = useState(false);
  const [loading, setLoading] = useState(true);
  const [lineageLoading, setLineageLoading] = useState(false);
  const [scrapeLoading, setScrapeLoading] = useState(false);
  const [hasWikiTreePhoto, setHasWikiTreePhoto] = useState(false);
  const [hasLinkedInPhoto, setHasLinkedInPhoto] = useState(false);
  // Platform linking dialog state
  const [linkingPlatform, setLinkingPlatform] = useState<'wikipedia' | 'ancestry' | 'wikitree' | 'linkedin' | null>(null);
  const [linkingLoading, setLinkingLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Canonical ID and external identities
  const [canonicalId, setCanonicalId] = useState<string | null>(null);
  const [externalIdentities, setExternalIdentities] = useState<Array<{ source: string; externalId: string; url?: string }>>([]);
  const [fetchingPhotoFrom, setFetchingPhotoFrom] = useState<string | null>(null);
  const [makeRootLoading, setMakeRootLoading] = useState(false);
  const [syncLoading, setSyncLoading] = useState(false);
  const [showUploadDialog, setShowUploadDialog] = useState(false);

  // Local overrides state
  const [overrides, setOverrides] = useState<PersonOverrides | null>(null);
  const [claims, setClaims] = useState<PersonClaim[]>([]);

  // Inline-add state for aliases and occupations
  const [addingAlias, setAddingAlias] = useState(false);
  const [addingOccupation, setAddingOccupation] = useState(false);

  useEffect(() => {
    if (!dbId || !personId) return;

    setLoading(true);
    setLineage(null);
    setScrapedData(null);
    setAugmentation(null);
    setHasPhoto(false);
    setHasFsPhoto(false);
    setHasWikiPhoto(false);
    setHasAncestryPhoto(false);
    setParentData({});
    setSpouseData({});
    setHasWikiTreePhoto(false);
    setHasLinkedInPhoto(false);
    setLinkingPlatform(null);
    setLinkingLoading(false);
    setCanonicalId(null);
    setExternalIdentities([]);
    setOverrides(null);
    setClaims([]);

    // Load canonical ID and external identities
    api.getIdentities(dbId, personId).then(data => {
      setCanonicalId(data.canonicalId);
      setExternalIdentities(data.identities);
    }).catch(() => null);

    // Load overrides and claims (separate from main data)
    api.getPersonOverrides(dbId, personId).then(setOverrides).catch(() => null);
    api.getPersonClaims(dbId, personId).then(setClaims).catch(() => []);

    Promise.all([
      api.getPerson(dbId, personId),
      api.getDatabase(dbId),
      api.getScrapedData(personId).catch(() => null),
      api.hasPhoto(personId).catch(() => ({ exists: false })),
      api.getAugmentation(personId).catch(() => null),
      api.hasWikiPhoto(personId).catch(() => ({ exists: false })),
      api.hasAncestryPhoto(personId).catch(() => ({ exists: false })),
      api.hasWikiTreePhoto(personId).catch(() => ({ exists: false })),
      api.hasLinkedInPhoto(personId).catch(() => ({ exists: false })),
    ])
      .then(async ([personData, dbData, scraped, photoCheck, augment, wikiPhotoCheck, ancestryPhotoCheck, wikiTreePhotoCheck, linkedInPhotoCheck]) => {
        setPerson(personData);
        setDatabase(dbData);
        setScrapedData(scraped);
        setHasPhoto(photoCheck?.exists ?? false);
        setHasFsPhoto((photoCheck as { exists: boolean; fsExists?: boolean })?.fsExists ?? false);
        setAugmentation(augment);
        setHasWikiPhoto(wikiPhotoCheck?.exists ?? false);
        setHasAncestryPhoto(ancestryPhotoCheck?.exists ?? false);
        setHasWikiTreePhoto(wikiTreePhotoCheck?.exists ?? false);
        setHasLinkedInPhoto(linkedInPhotoCheck?.exists ?? false);

        // Fetch parent data for names
        if (personData.parents.length > 0) {
          const parentResults = await Promise.all(
            personData.parents.map((pid: string) => api.getPerson(dbId, pid).catch(() => null))
          );
          const parents: Record<string, PersonWithId> = {};
          parentResults.forEach((p: PersonWithId | null, idx: number) => {
            if (p) parents[personData.parents[idx]] = p;
          });
          setParentData(parents);
        }

        // Fetch spouse data for names
        if (personData.spouses && personData.spouses.length > 0) {
          const spouseResults = await Promise.all(
            personData.spouses.map((sid: string) => api.getPerson(dbId, sid).catch(() => null))
          );
          const spouses: Record<string, PersonWithId> = {};
          spouseResults.forEach((s: PersonWithId | null, idx: number) => {
            if (s && personData.spouses) spouses[personData.spouses[idx]] = s;
          });
          setSpouseData(spouses);
        }

        // Check for cached lineage
        const cached = getCachedLineage(dbId, personId);
        if (cached) {
          setLineage(cached);
        }
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [dbId, personId]);

  const calculateLineage = async () => {
    if (!dbId || !personId || !database?.rootId) return;
    if (database.rootId === personId) return;

    setLineageLoading(true);

    const result = await api.findPath(dbId, personId, database.rootId, 'shortest')
      .catch(() => null);

    if (result) {
      setLineage(result);
      setCachedLineage(dbId, personId, result);
    }

    setLineageLoading(false);
  };

  const handleScrape = async () => {
    if (!personId) return;

    setScrapeLoading(true);

    const data = await api.scrapePerson(personId)
      .catch(err => {
        toast.error(err.message);
        return null;
      });

    if (data) {
      setScrapedData(data);
      setHasPhoto(!!data.photoPath);
      toast.success('Person data scraped successfully');
    }

    setScrapeLoading(false);
  };

  const handleLinkPlatform = async (platform: 'wikipedia' | 'ancestry' | 'wikitree' | 'linkedin', url: string) => {
    if (!personId || !url.trim()) return;

    setLinkingLoading(true);

    const linkFn = platform === 'wikipedia' ? api.linkWikipedia
      : platform === 'ancestry' ? api.linkAncestry
      : platform === 'linkedin' ? api.linkLinkedIn
      : api.linkWikiTree;

    const data = await linkFn(personId, url.trim())
      .catch(err => {
        toast.error(err.message);
        return null;
      });

    if (data) {
      setAugmentation(data);
      // Check for photo from the linked platform
      const photoCheckFn = platform === 'wikipedia' ? api.hasWikiPhoto
        : platform === 'ancestry' ? api.hasAncestryPhoto
        : platform === 'linkedin' ? api.hasLinkedInPhoto
        : api.hasWikiTreePhoto;
      const photoExists = await photoCheckFn(personId).catch(() => ({ exists: false }));

      if (platform === 'wikipedia') setHasWikiPhoto(photoExists?.exists ?? false);
      else if (platform === 'ancestry') setHasAncestryPhoto(photoExists?.exists ?? false);
      else if (platform === 'linkedin') setHasLinkedInPhoto(photoExists?.exists ?? false);
      else setHasWikiTreePhoto(photoExists?.exists ?? false);

      setLinkingPlatform(null);
      toast.success(`${platform.charAt(0).toUpperCase() + platform.slice(1)} linked successfully`);
    }

    setLinkingLoading(false);
  };

  const handleFetchPhotoFromPlatform = async (platform: string) => {
    if (!personId) return;

    setFetchingPhotoFrom(platform);

    const data = await api.fetchPhotoFromPlatform(personId, platform)
      .catch(err => {
        toast.error(err.message);
        return null;
      });

    if (data) {
      setAugmentation(data);
      // Refresh photo existence checks
      const [wikiExists, ancestryExists, wikiTreeExists, linkedInExists] = await Promise.all([
        api.hasWikiPhoto(personId).catch(() => ({ exists: false })),
        api.hasAncestryPhoto(personId).catch(() => ({ exists: false })),
        api.hasWikiTreePhoto(personId).catch(() => ({ exists: false })),
        api.hasLinkedInPhoto(personId).catch(() => ({ exists: false })),
      ]);
      setHasWikiPhoto(wikiExists?.exists ?? false);
      setHasAncestryPhoto(ancestryExists?.exists ?? false);
      setHasWikiTreePhoto(wikiTreeExists?.exists ?? false);
      setHasLinkedInPhoto(linkedInExists?.exists ?? false);
      toast.success(`Photo fetched from ${platform}`);
    }

    setFetchingPhotoFrom(null);
  };

  const handleMakeRoot = async () => {
    if (!personId) return;

    setMakeRootLoading(true);

    const newRoot = await api.createRoot(personId).catch(err => {
      toast.error(err.message);
      return null;
    });

    if (newRoot) {
      toast.success(`"${newRoot.rootName}" is now a root entry point`);
      // Refresh sidebar to show the new root database
      await refreshDatabases();
      // Expand the new database in the sidebar
      expandDatabase(newRoot.id);
      // Navigate to the new root's person page
      navigate(`/person/${newRoot.id}/${personId}`);
    }

    setMakeRootLoading(false);
  };

  const handleSyncFromFamilySearch = async () => {
    if (!dbId || !personId) return;

    setSyncLoading(true);

    const result = await api.syncFromFamilySearch(dbId, personId).catch(err => {
      toast.error(err.message);
      return null;
    });

    if (result) {
      if (result.wasRedirected) {
        // Person was merged/redirected on FamilySearch
        toast.success(
          `Person was merged on FamilySearch: ${result.originalFsId} → ${result.newFsId}${result.survivingPersonName ? ` (${result.survivingPersonName})` : ''}. ID mappings updated.`,
          { duration: 6000 }
        );

        // Refresh the identities to show the updated FamilySearch ID
        api.getIdentities(dbId, personId).then(data => {
          setCanonicalId(data.canonicalId);
          setExternalIdentities(data.identities);
        }).catch(() => null);
      } else {
        toast.success('Person is up to date with FamilySearch');
      }

      // Also scrape photo from FamilySearch as part of download
      const scrapeData = await api.scrapePerson(personId).catch(() => null);
      if (scrapeData?.photoPath) {
        setHasPhoto(true);
        setHasFsPhoto(true);
        toast.success('Photo downloaded from FamilySearch');
      }
    }

    setSyncLoading(false);
  };

  // =============================================================================
  // LOCAL OVERRIDE HANDLERS
  // =============================================================================

  const refreshOverrides = useCallback(async () => {
    if (!dbId || !personId) return;
    const [newOverrides, newClaims] = await Promise.all([
      api.getPersonOverrides(dbId, personId).catch(() => null),
      api.getPersonClaims(dbId, personId).catch(() => []),
    ]);
    if (newOverrides) setOverrides(newOverrides);
    setClaims(newClaims);
  }, [dbId, personId]);

  const handleSavePersonField = useCallback(async (fieldName: string, value: string, originalValue: string | null) => {
    if (!dbId || !personId) return;
    await api.setPersonOverride(dbId, personId, {
      entityType: 'person',
      fieldName,
      value,
      originalValue,
    });
    await refreshOverrides();
    // Refresh person data to show new values
    const newPerson = await api.getPerson(dbId, personId);
    if (newPerson) setPerson(newPerson);
    toast.success('Saved');
  }, [dbId, personId, refreshOverrides]);

  const handleRevertPersonField = useCallback(async (fieldName: string) => {
    if (!dbId || !personId) return;
    await api.revertPersonOverride(dbId, personId, {
      entityType: 'person',
      fieldName,
    });
    await refreshOverrides();
    toast.success('Reverted to original');
  }, [dbId, personId, refreshOverrides]);

  const handleSaveVitalEventField = useCallback(async (eventType: string, fieldName: string, value: string, originalValue: string | null) => {
    if (!dbId || !personId) return;
    await api.setPersonOverride(dbId, personId, {
      entityType: 'vital_event',
      fieldName: `${eventType}_${fieldName}`,
      value,
      originalValue,
    });
    await refreshOverrides();
    toast.success('Saved');
  }, [dbId, personId, refreshOverrides]);

  const handleRevertVitalEventField = useCallback(async (eventType: string, fieldName: string) => {
    if (!dbId || !personId) return;
    await api.revertPersonOverride(dbId, personId, {
      entityType: 'vital_event',
      fieldName: `${eventType}_${fieldName}`,
    });
    await refreshOverrides();
    toast.success('Reverted to original');
  }, [dbId, personId, refreshOverrides]);

  const handleAddClaim = useCallback(async (predicate: string, value: string) => {
    if (!dbId || !personId) return;
    await api.addPersonClaim(dbId, personId, predicate, value);
    await refreshOverrides();
    // Refresh person data
    const newPerson = await api.getPerson(dbId, personId);
    if (newPerson) setPerson(newPerson);
    toast.success('Added');
  }, [dbId, personId, refreshOverrides]);

  const handleDeleteClaim = useCallback(async (claimId: string) => {
    if (!dbId || !personId) return;
    await api.deletePersonClaim(dbId, personId, claimId);
    await refreshOverrides();
    // Refresh person data
    const newPerson = await api.getPerson(dbId, personId);
    if (newPerson) setPerson(newPerson);
    toast.success('Deleted');
  }, [dbId, personId, refreshOverrides]);

  // =============================================================================
  // HELPER FUNCTIONS FOR OVERRIDES
  // =============================================================================

  // Get override for a person field
  const getPersonOverride = (fieldName: string) => {
    return overrides?.personOverrides?.find(o => o.fieldName === fieldName);
  };

  // Get override for a vital event field (stored as eventType_fieldName, e.g., birth_date)
  const getVitalEventOverride = (eventType: string, fieldName: string) => {
    return overrides?.eventOverrides?.find(o => o.fieldName === `${eventType}_${fieldName}`);
  };

  // Build VitalEventOverrides object for a given event type
  const buildVitalEventOverrides = (eventType: string): VitalEventOverrides => {
    const dateOverride = getVitalEventOverride(eventType, 'date');
    const placeOverride = getVitalEventOverride(eventType, 'place');
    return {
      date: dateOverride ? {
        value: dateOverride.overrideValue,
        originalValue: dateOverride.originalValue,
        isOverridden: true,
      } : undefined,
      place: placeOverride ? {
        value: placeOverride.overrideValue,
        originalValue: placeOverride.originalValue,
        isOverridden: true,
      } : undefined,
    };
  };

  // Build ListItem array from claims for EditableList
  const buildClaimsListItems = (predicate: string): ListItem[] => {
    return claims
      .filter(c => c.predicate === predicate)
      .map(c => ({
        id: c.claimId,
        value: c.value,
        source: c.source,
        isOverridden: c.isOverridden,
        originalValue: c.originalValue,
      }));
  };

  if (loading) {
    return <div className="text-center py-8 text-app-text-muted">Loading person...</div>;
  }

  if (error || !person) {
    return <div className="text-center py-8 text-app-error">Error: {error || 'Person not found'}</div>;
  }

  const isRoot = database?.rootId === personId;
  const generations = lineage ? lineage.path.length - 1 : 0;
  const relationship = isRoot ? 'Root Person (You)' : lineage ? getRelationshipLabel(generations) : null;
  // Photo priority: Ancestry > WikiTree > LinkedIn > Wiki > FamilySearch scraped
  const photoUrl = hasAncestryPhoto
    ? api.getAncestryPhotoUrl(personId!)
    : hasWikiTreePhoto
      ? api.getWikiTreePhotoUrl(personId!)
      : hasLinkedInPhoto
        ? api.getLinkedInPhotoUrl(personId!)
        : hasWikiPhoto
          ? api.getWikiPhotoUrl(personId!)
          : hasPhoto
            ? api.getPhotoUrl(personId!)
            : null;

  // Get primary description from augmentation
  const wikiDescription = augmentation?.descriptions?.find(d => d.source === 'wikipedia')?.text;

  // Get Wikipedia platform info
  const wikiPlatform = augmentation?.platforms?.find(p => p.platform === 'wikipedia');

  // Helper to format ID for display (show abbreviated)
  const formatIdForDisplay = (id: string) => {
    if (id.length > 12) return `${id.slice(0, 8)}...`;
    return id;
  };

  // Get external ID by source
  const getExternalId = (source: string) => {
    return externalIdentities.find(i => i.source === source)?.externalId;
  };

  const fsId = getExternalId('familysearch') || person?.externalId;
  const ancestryId = getExternalId('ancestry');
  const wikiTreeId = getExternalId('wikitree');

  return (
    <div className="h-full flex flex-col">
      {/* Header - Compact layout */}
      <div className="mb-4 flex gap-4">
        {/* Profile Photo - smaller */}
        <div className="flex-shrink-0">
          {photoUrl ? (
            <img
              src={photoUrl}
              alt={person.name}
              className="w-24 h-24 rounded-lg object-cover border border-app-border"
            />
          ) : (
            <div className="w-24 h-24 rounded-lg bg-app-card border border-app-border flex items-center justify-center">
              <User size={36} className="text-app-text-subtle" />
            </div>
          )}
        </div>

        {/* Name, badges, and IDs */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              {/* Name + Edit button close together */}
              <div className="flex items-center gap-2 mb-1">
                <EditableField
                  value={getPersonOverride('display_name')?.overrideValue ?? person.name}
                  originalValue={person.name}
                  isOverridden={!!getPersonOverride('display_name')}
                  onSave={async (value) => { await handleSavePersonField('display_name', value, person.name); }}
                  onRevert={async () => { await handleRevertPersonField('display_name'); }}
                  displayClassName="text-2xl font-bold"
                  inputClassName="text-2xl font-bold"
                  placeholder="Enter name..."
                  className="flex-1 min-w-0"
                />
                {/* Gender badge */}
                {person.gender && person.gender !== 'unknown' && (
                  <span className={`px-2 py-0.5 rounded text-xs ${
                    person.gender === 'male' ? 'bg-app-male-subtle text-app-male' : 'bg-app-female-subtle text-app-female'
                  }`}>
                    {person.gender === 'male' ? 'Male' : 'Female'}
                  </span>
                )}
                <FavoriteButton dbId={dbId!} personId={personId!} personName={person.name} />
              </div>

              {/* Lifespan - smaller */}
              <p className="text-sm text-app-text-muted">
                {person.lifespan.endsWith('-') ? `${person.lifespan}Living` : person.lifespan}
              </p>

              {/* IDs inline - no toggle */}
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1 text-xs text-app-text-subtle">
                {canonicalId && (
                  <button
                    onClick={() => { navigator.clipboard.writeText(canonicalId); toast.success('Copied ID'); }}
                    className="font-mono flex items-center gap-0.5 hover:text-app-text transition-colors"
                    title={`Copy ${canonicalId}`}
                  >
                    ID: {formatIdForDisplay(canonicalId)}
                    <Copy size={10} />
                  </button>
                )}
                {fsId && (
                  <>
                    <span className="text-app-border">|</span>
                    <a
                      href={`https://www.familysearch.org/tree/person/details/${fsId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sky-600 dark:text-sky-400 hover:underline flex items-center gap-0.5"
                    >
                      FS: {fsId}
                      <ExternalLink size={10} />
                    </a>
                  </>
                )}
                {ancestryId && (
                  <>
                    <span className="text-app-border">|</span>
                    <button
                      onClick={() => { navigator.clipboard.writeText(ancestryId); toast.success('Copied Ancestry ID'); }}
                      className="text-emerald-600 dark:text-emerald-400 flex items-center gap-0.5 hover:underline"
                      title={`Copy ${ancestryId}`}
                    >
                      Ancestry: {ancestryId}
                      <Copy size={10} />
                    </button>
                  </>
                )}
                {wikiTreeId && (
                  <>
                    <span className="text-app-border">|</span>
                    <button
                      onClick={() => { navigator.clipboard.writeText(wikiTreeId); toast.success('Copied WikiTree ID'); }}
                      className="text-purple-600 dark:text-purple-400 flex items-center gap-0.5 hover:underline"
                      title={`Copy ${wikiTreeId}`}
                    >
                      WikiTree: {wikiTreeId}
                      <Copy size={10} />
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Badges on right side */}
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {isRoot && (
                <span className="px-2 py-0.5 bg-app-success/20 text-app-success rounded text-xs font-medium">
                  Root Person
                </span>
              )}
              {lineage && !isRoot && (
                <span className="px-2 py-0.5 bg-app-accent/20 text-app-accent rounded text-xs font-medium">
                  {relationship}
                </span>
              )}
              {!lineage && !isRoot && (
                <button
                  onClick={calculateLineage}
                  disabled={lineageLoading}
                  className="px-2 py-0.5 bg-app-accent/20 text-app-accent rounded text-xs font-medium hover:bg-app-accent/30 transition-colors disabled:opacity-50 flex items-center gap-1"
                >
                  {lineageLoading ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <GitBranch size={12} />
                  )}
                  Lineage
                </button>
              )}
              {!isRoot && (
                <button
                  onClick={handleMakeRoot}
                  disabled={makeRootLoading}
                  className="flex items-center gap-1 px-2 py-0.5 bg-app-success/20 text-app-success rounded text-xs hover:bg-app-success/30 transition-colors disabled:opacity-50"
                  title="Make this person a root entry point"
                >
                  {makeRootLoading ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <TreeDeciduous size={12} />
                  )}
                  Root
                </button>
              )}
              <Link
                to={`/tree/${dbId}/${personId}`}
                className="text-app-text-muted hover:text-app-accent flex items-center gap-1 text-xs"
              >
                <GitBranch size={12} />
                Tree
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Main content - compact layout */}
      <div className="flex-1 space-y-3">
        {/* Compact Vital Events + Family in single row */}
        <div className="bg-app-card rounded-lg border border-app-border p-3">
          {/* Vital Events - single row */}
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            {/* Birth */}
            <div className="flex items-center gap-2">
              <Calendar size={14} className="text-app-success shrink-0" />
              <span className="text-app-text-muted">Birth:</span>
              <EditableDate
                value={buildVitalEventOverrides('birth').date?.value ?? person.birth?.date}
                originalValue={person.birth?.date}
                isOverridden={buildVitalEventOverrides('birth').date?.isOverridden ?? false}
                onSave={(value) => handleSaveVitalEventField('birth', 'date', value, person.birth?.date ?? null)}
                onRevert={() => handleRevertVitalEventField('birth', 'date')}
                emptyText="—"
                compact
              />
              {person.birth?.place && (
                <span className="text-app-text-subtle text-xs truncate max-w-[150px]" title={person.birth.place}>
                  • {person.birth.place}
                </span>
              )}
            </div>

            {/* Death */}
            <div className="flex items-center gap-2">
              <Calendar size={14} className="text-app-error shrink-0" />
              <span className="text-app-text-muted">Death:</span>
              <EditableDate
                value={buildVitalEventOverrides('death').date?.value ?? person.death?.date}
                originalValue={person.death?.date}
                isOverridden={buildVitalEventOverrides('death').date?.isOverridden ?? false}
                onSave={(value) => handleSaveVitalEventField('death', 'date', value, person.death?.date ?? null)}
                onRevert={() => handleRevertVitalEventField('death', 'date')}
                emptyText="Living"
                compact
              />
              {person.death?.place && (
                <span className="text-app-text-subtle text-xs truncate max-w-[150px]" title={person.death.place}>
                  • {person.death.place}
                </span>
              )}
            </div>

            {/* Burial */}
            {(person.burial?.date || person.burial?.place) && (
              <div className="flex items-center gap-2">
                <MapPin size={14} className="text-app-text-muted shrink-0" />
                <span className="text-app-text-muted">Burial:</span>
                {person.burial?.date && (
                  <span className="text-app-text text-sm">{person.burial.date}</span>
                )}
                {person.burial?.place && (
                  <span className="text-app-text-subtle text-xs truncate max-w-[150px]" title={person.burial.place}>
                    {person.burial.date ? '• ' : ''}{person.burial.place}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Family - Parents/Spouses/Children in second row */}
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm mt-3 pt-3 border-t border-app-border/50">
            {/* Parents */}
            <div className="flex items-center gap-2">
              <Users size={14} className="text-app-accent shrink-0" />
              <span className="text-app-text-muted">Parents:</span>
              {person.parents.length > 0 ? (
                <span className="flex items-center gap-1">
                  {person.parents.map((parentId, idx) => {
                    const parent = parentData[parentId];
                    return (
                      <span key={parentId} className="flex items-center">
                        <Link
                          to={`/person/${dbId}/${parentId}`}
                          className="text-app-text hover:text-app-accent"
                        >
                          {parent?.name || formatIdForDisplay(parentId)}
                        </Link>
                        <span className={`ml-1 text-xs px-1 py-0.5 rounded ${
                          idx === 0 ? 'bg-app-male-subtle text-app-male' : 'bg-app-female-subtle text-app-female'
                        }`}>
                          {idx === 0 ? 'F' : 'M'}
                        </span>
                        {idx < person.parents.length - 1 && <span className="mx-1 text-app-border">,</span>}
                      </span>
                    );
                  })}
                </span>
              ) : (
                <span className="text-app-text-subtle">—</span>
              )}
            </div>

            {/* Spouses */}
            {person.spouses && person.spouses.length > 0 && (
              <div className="flex items-center gap-2">
                <Heart size={14} className="text-pink-400 shrink-0" />
                <span className="text-app-text-muted">Spouse{person.spouses.length > 1 ? 's' : ''}:</span>
                {person.spouses.map((spouseId, idx) => {
                  const spouse = spouseData[spouseId];
                  return (
                    <span key={spouseId}>
                      <Link
                        to={`/person/${dbId}/${spouseId}`}
                        className="text-app-text hover:text-app-accent"
                      >
                        {spouse?.name || formatIdForDisplay(spouseId)}
                      </Link>
                      {idx < (person.spouses?.length ?? 0) - 1 && <span className="text-app-border">, </span>}
                    </span>
                  );
                })}
              </div>
            )}

            {/* Children */}
            <div className="flex items-center gap-2">
              <Users size={14} className="text-app-success shrink-0" />
              <span className="text-app-text-muted">Children:</span>
              {person.children.length > 0 ? (
                <Link
                  to={`/tree/${dbId}/${personId}`}
                  className="text-app-success hover:underline"
                >
                  {person.children.length}
                </Link>
              ) : (
                <span className="text-app-text-subtle">None</span>
              )}
            </div>
          </div>
        </div>

        {/* Inline Aliases (Also Known As) + Occupations */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Aliases as inline tags */}
          <div className="bg-app-card rounded-lg border border-app-border p-3">
            <div className="flex items-center justify-between mb-2">
              <h3 className="flex items-center gap-1.5 text-xs font-semibold text-app-text-secondary">
                <User size={14} className="text-app-accent" />
                Also Known As
              </h3>
              <button
                onClick={() => setAddingAlias(true)}
                className="text-xs text-app-accent hover:underline"
              >
                + Add
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {buildClaimsListItems('alias').length > 0 ? (
                [...buildClaimsListItems('alias')]
                  .sort((a, b) => a.value.toLowerCase().localeCompare(b.value.toLowerCase()))
                  .map(item => (
                    <span
                      key={item.id}
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs ${
                        item.source === 'user' ? 'bg-app-accent/20 text-app-accent' : 'bg-app-bg text-app-text-secondary'
                      }`}
                    >
                      {item.value}
                      {item.source === 'user' && (
                        <button
                          onClick={() => handleDeleteClaim(item.id)}
                          className="hover:text-app-error"
                          title="Remove"
                        >
                          ×
                        </button>
                      )}
                    </span>
                  ))
              ) : (
                !addingAlias && <span className="text-xs text-app-text-subtle">No aliases</span>
              )}
            </div>
            {addingAlias && (
              <InlineAddInput
                placeholder="Enter new alias..."
                onAdd={(value) => { handleAddClaim('alias', value); setAddingAlias(false); }}
                onCancel={() => setAddingAlias(false)}
              />
            )}
          </div>

          {/* Occupations as inline tags */}
          <div className="bg-app-card rounded-lg border border-app-border p-3">
            <div className="flex items-center justify-between mb-2">
              <h3 className="flex items-center gap-1.5 text-xs font-semibold text-app-text-secondary">
                <Briefcase size={14} className="text-app-warning" />
                Occupations
              </h3>
              <button
                onClick={() => setAddingOccupation(true)}
                className="text-xs text-app-accent hover:underline"
              >
                + Add
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {buildClaimsListItems('occupation').length > 0 ? (
                buildClaimsListItems('occupation').map(item => (
                  <span
                    key={item.id}
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs ${
                      item.source === 'user' ? 'bg-app-warning/20 text-app-warning' : 'bg-app-bg text-app-text-secondary'
                    }`}
                  >
                    {item.value}
                    {item.source === 'user' && (
                      <button
                        onClick={() => handleDeleteClaim(item.id)}
                        className="hover:text-app-error"
                        title="Remove"
                      >
                        ×
                      </button>
                    )}
                  </span>
                ))
              ) : (
                !addingOccupation && <span className="text-xs text-app-text-subtle">No occupations</span>
              )}
            </div>
            {addingOccupation && (
              <InlineAddInput
                placeholder="Enter new occupation..."
                onAdd={(value) => { handleAddClaim('occupation', value); setAddingOccupation(false); }}
                onCancel={() => setAddingOccupation(false)}
              />
            )}
          </div>
        </div>

          {/* Compact Biography Section */}
          <div className="bg-app-card rounded-lg border border-app-border p-3">
            <div className="flex items-center justify-between mb-2">
              <h3 className="flex items-center gap-1.5 text-xs font-semibold text-app-text-secondary">
                <BookOpen size={14} className="text-app-accent" />
                Biography
              </h3>
            </div>
            {wikiDescription ? (
              <div className="space-y-2">
                <p className="text-xs text-app-text-muted line-clamp-3">{wikiDescription}</p>
                {wikiPlatform?.url && (
                  <a
                    href={wikiPlatform.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-app-accent hover:underline"
                  >
                    <ExternalLink size={10} />
                    Wikipedia
                  </a>
                )}
              </div>
            ) : (
              <EditableField
                value={getPersonOverride('bio')?.overrideValue ?? person.bio}
                originalValue={person.bio}
                isOverridden={!!getPersonOverride('bio')}
                onSave={(value) => handleSavePersonField('bio', value, person.bio ?? null)}
                onRevert={() => handleRevertPersonField('bio')}
                placeholder="Add biography..."
                emptyText="No biography"
                multiline
                displayClassName="text-xs text-app-text-muted"
              />
            )}
          </div>

          {/* Provider Data Table */}
          <ProviderDataTable
            dbId={dbId!}
            personId={personId!}
            localData={{
              name: getPersonOverride('display_name')?.overrideValue ?? person.name,
              birthDate: buildVitalEventOverrides('birth').date?.value ?? person.birth?.date ?? undefined,
              deathDate: buildVitalEventOverrides('death').date?.value ?? person.death?.date ?? undefined,
              fatherName: person.parents[0] ? (parentData[person.parents[0]]?.name || person.parents[0]) : undefined,
              motherName: person.parents[1] ? (parentData[person.parents[1]]?.name || person.parents[1]) : undefined,
              bio: getPersonOverride('bio')?.overrideValue ?? person.bio ?? undefined,
              occupations: buildClaimsListItems('occupation').map(c => c.value),
              alternateNames: buildClaimsListItems('alias').map(c => c.value),
              childrenCount: person.children.length,
            }}
            externalId={externalIdentities.find(i => i.source === 'familysearch')?.externalId || person?.externalId}
            augmentation={augmentation}
            hasPhoto={hasPhoto}
            hasFsPhoto={hasFsPhoto}
            hasWikiPhoto={hasWikiPhoto}
            hasAncestryPhoto={hasAncestryPhoto}
            hasWikiTreePhoto={hasWikiTreePhoto}
            hasLinkedInPhoto={hasLinkedInPhoto}
            onSyncFromFamilySearch={handleSyncFromFamilySearch}
            onScrapePhoto={handleScrape}
            onFetchPhoto={handleFetchPhotoFromPlatform}
            onShowUploadDialog={() => setShowUploadDialog(true)}
            onShowLinkInput={(platform) => setLinkingPlatform(platform)}
            syncLoading={syncLoading}
            scrapeLoading={scrapeLoading}
            fetchingPhotoFrom={fetchingPhotoFrom}
          />

          {/* Lineage path - compact */}
          {lineage && lineage.path.length > 1 && (
            <div className="bg-app-card rounded-lg border border-app-border p-3">
              <h3 className="flex items-center gap-1.5 text-xs font-semibold text-app-text-secondary mb-2">
                <GitBranch size={14} className="text-app-warning" />
                Lineage Path ({lineage.path.length} generations)
              </h3>
              <div className="flex flex-wrap gap-1">
                {lineage.path.map((ancestor, idx) => (
                  <Link
                    key={ancestor.id}
                    to={`/person/${dbId}/${ancestor.id}`}
                    className={`px-2 py-0.5 rounded text-xs transition-colors ${
                      ancestor.id === personId
                        ? 'bg-app-accent/20 text-app-accent font-medium'
                        : 'bg-app-bg text-app-text-muted hover:bg-app-border hover:text-app-text'
                    }`}
                    title={ancestor.name}
                  >
                    {idx}. {ancestor.name.split(' ')[0]}
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>

      {/* Upload to FamilySearch Dialog */}
      {showUploadDialog && dbId && personId && (
        <UploadToFamilySearchDialog
          dbId={dbId}
          personId={personId}
          onClose={() => setShowUploadDialog(false)}
        />
      )}

      {/* Link Platform Dialog */}
      <LinkPlatformDialog
        platform={linkingPlatform}
        onClose={() => setLinkingPlatform(null)}
        onLink={handleLinkPlatform}
        loading={linkingLoading}
      />
    </div>
  );
}
