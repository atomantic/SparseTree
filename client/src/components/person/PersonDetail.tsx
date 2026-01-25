import { useEffect, useState, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { Briefcase, Users, ExternalLink, GitBranch, Loader2, User, BookOpen, Heart, ChevronDown, ChevronRight, Fingerprint, TreeDeciduous } from 'lucide-react';
import toast from 'react-hot-toast';
import type { PersonWithId, PathResult, DatabaseInfo, PersonAugmentation } from '@fsf/shared';
import { api, LegacyScrapedPersonData, PersonOverrides, PersonClaim } from '../../services/api';
import { FavoriteButton } from '../favorites/FavoriteButton';
import { useSidebar } from '../../context/SidebarContext';
import { EditableField } from '../ui/EditableField';
import type { ListItem } from '../ui/EditableList';
import { VitalEventCard, VitalEventOverrides } from './VitalEventCard';
import { UploadToFamilySearchDialog } from './UploadToFamilySearchDialog';
import { UnifiedPlatformSection } from './UnifiedPlatformSection';
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

export function PersonDetail() {
  const { dbId, personId } = useParams<{ dbId: string; personId: string }>();
  const navigate = useNavigate();
  const { refreshDatabases, expandDatabase } = useSidebar();
  const [person, setPerson] = useState<PersonWithId | null>(null);
  const [parentData, setParentData] = useState<Record<string, PersonWithId>>({});
  const [spouseData, setSpouseData] = useState<Record<string, PersonWithId>>({});
  const [database, setDatabase] = useState<DatabaseInfo | null>(null);
  const [lineage, setLineage] = useState<PathResult | null>(null);
  const [scrapedData, setScrapedData] = useState<LegacyScrapedPersonData | null>(null);
  const [augmentation, setAugmentation] = useState<PersonAugmentation | null>(null);
  const [hasPhoto, setHasPhoto] = useState(false);
  const [hasWikiPhoto, setHasWikiPhoto] = useState(false);
  const [hasAncestryPhoto, setHasAncestryPhoto] = useState(false);
  const [loading, setLoading] = useState(true);
  const [lineageLoading, setLineageLoading] = useState(false);
  const [scrapeLoading, setScrapeLoading] = useState(false);
  const [hasWikiTreePhoto, setHasWikiTreePhoto] = useState(false);
  // Platform linking dialog state
  const [linkingPlatform, setLinkingPlatform] = useState<'wikipedia' | 'ancestry' | 'wikitree' | null>(null);
  const [linkingLoading, setLinkingLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Canonical ID and external identities
  const [canonicalId, setCanonicalId] = useState<string | null>(null);
  const [externalIdentities, setExternalIdentities] = useState<Array<{ source: string; externalId: string; url?: string }>>([])
  const [showIdentities, setShowIdentities] = useState(false);
  const [fetchingPhotoFrom, setFetchingPhotoFrom] = useState<string | null>(null);
  const [makeRootLoading, setMakeRootLoading] = useState(false);
  const [syncLoading, setSyncLoading] = useState(false);
  const [showUploadDialog, setShowUploadDialog] = useState(false);

  // Local overrides state
  const [overrides, setOverrides] = useState<PersonOverrides | null>(null);
  const [claims, setClaims] = useState<PersonClaim[]>([]);

  useEffect(() => {
    if (!dbId || !personId) return;

    setLoading(true);
    setLineage(null);
    setScrapedData(null);
    setAugmentation(null);
    setHasPhoto(false);
    setHasWikiPhoto(false);
    setHasAncestryPhoto(false);
    setParentData({});
    setSpouseData({});
    setHasWikiTreePhoto(false);
    setLinkingPlatform(null);
    setLinkingLoading(false);
    setCanonicalId(null);
    setExternalIdentities([]);
    setShowIdentities(false);
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
    ])
      .then(async ([personData, dbData, scraped, photoCheck, augment, wikiPhotoCheck, ancestryPhotoCheck, wikiTreePhotoCheck]) => {
        setPerson(personData);
        setDatabase(dbData);
        setScrapedData(scraped);
        setHasPhoto(photoCheck?.exists ?? false);
        setAugmentation(augment);
        setHasWikiPhoto(wikiPhotoCheck?.exists ?? false);
        setHasAncestryPhoto(ancestryPhotoCheck?.exists ?? false);
        setHasWikiTreePhoto(wikiTreePhotoCheck?.exists ?? false);

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

  const handleLinkPlatform = async (platform: 'wikipedia' | 'ancestry' | 'wikitree', url: string) => {
    if (!personId || !url.trim()) return;

    setLinkingLoading(true);

    const linkFn = platform === 'wikipedia' ? api.linkWikipedia
      : platform === 'ancestry' ? api.linkAncestry
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
        : api.hasWikiTreePhoto;
      const photoExists = await photoCheckFn(personId).catch(() => ({ exists: false }));

      if (platform === 'wikipedia') setHasWikiPhoto(photoExists?.exists ?? false);
      else if (platform === 'ancestry') setHasAncestryPhoto(photoExists?.exists ?? false);
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
      const [wikiExists, ancestryExists, wikiTreeExists] = await Promise.all([
        api.hasWikiPhoto(personId).catch(() => ({ exists: false })),
        api.hasAncestryPhoto(personId).catch(() => ({ exists: false })),
        api.hasWikiTreePhoto(personId).catch(() => ({ exists: false }))
      ]);
      setHasWikiPhoto(wikiExists?.exists ?? false);
      setHasAncestryPhoto(ancestryExists?.exists ?? false);
      setHasWikiTreePhoto(wikiTreeExists?.exists ?? false);
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
  // Photo priority: Ancestry > WikiTree > Wiki > FamilySearch scraped
  const photoUrl = hasAncestryPhoto
    ? api.getAncestryPhotoUrl(personId!)
    : hasWikiTreePhoto
      ? api.getWikiTreePhotoUrl(personId!)
      : hasWikiPhoto
        ? api.getWikiPhotoUrl(personId!)
        : hasPhoto
          ? api.getPhotoUrl(personId!)
          : null;

  // Get primary description from augmentation
  const wikiDescription = augmentation?.descriptions?.find(d => d.source === 'wikipedia')?.text;

  // Get Wikipedia platform info
  const wikiPlatform = augmentation?.platforms?.find(p => p.platform === 'wikipedia');

  return (
    <div className="h-full flex flex-col">
      {/* Header with photo and relationship badge */}
      <div className="mb-6 flex gap-6">
        {/* Profile Photo */}
        <div className="flex-shrink-0">
          {photoUrl ? (
            <img
              src={photoUrl}
              alt={person.name}
              className="w-32 h-32 rounded-lg object-cover border border-app-border"
            />
          ) : (
            <div className="w-32 h-32 rounded-lg bg-app-card border border-app-border flex items-center justify-center">
              <User size={48} className="text-app-text-subtle" />
            </div>
          )}
        </div>

        {/* Name and badges */}
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-2 flex-wrap">
            {isRoot && (
              <span className="px-3 py-1 bg-app-success/20 text-app-success rounded-full text-sm font-medium">
                Root Person (You)
              </span>
            )}
            {lineage && !isRoot && (
              <span className="px-3 py-1 bg-app-accent/20 text-app-accent rounded-full text-sm font-medium">
                {relationship} ({generations} generation{generations !== 1 ? 's' : ''})
              </span>
            )}
            {!lineage && !isRoot && (
              <button
                onClick={calculateLineage}
                disabled={lineageLoading}
                className="px-3 py-1 bg-app-accent/20 text-app-accent rounded-full text-sm font-medium hover:bg-app-accent/30 transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {lineageLoading ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    Calculating...
                  </>
                ) : (
                  <>
                    <GitBranch size={14} />
                    Calculate Relationship
                  </>
                )}
              </button>
            )}
            {/* Gender badge */}
            {person.gender && person.gender !== 'unknown' && (
              <span className={`px-2 py-0.5 rounded text-xs ${
                person.gender === 'male' ? 'bg-app-male-subtle text-app-male' : 'bg-app-female-subtle text-app-female'
              }`}>
                {person.gender === 'male' ? 'Male' : 'Female'}
              </span>
            )}
            {/* Favorite button */}
            <FavoriteButton dbId={dbId!} personId={personId!} personName={person.name} />
            {/* Make Root button - only show if not already a root */}
            {!isRoot && (
              <button
                onClick={handleMakeRoot}
                disabled={makeRootLoading}
                className="flex items-center gap-1.5 px-3 py-1 bg-app-success/20 text-app-success rounded hover:bg-app-success/30 transition-colors text-sm disabled:opacity-50"
                title="Make this person a root entry point"
              >
                {makeRootLoading ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <TreeDeciduous size={14} />
                    Make Root
                  </>
                )}
              </button>
            )}
            <Link
              to={`/tree/${dbId}/${personId}`}
              className="text-app-text-muted hover:text-app-accent flex items-center gap-1 text-sm"
            >
              <GitBranch size={14} />
              View in tree
            </Link>
          </div>

          {/* Editable Person Name */}
          <EditableField
            value={getPersonOverride('display_name')?.overrideValue ?? person.name}
            originalValue={person.name}
            isOverridden={!!getPersonOverride('display_name')}
            onSave={(value) => handleSavePersonField('display_name', value, person.name)}
            onRevert={() => handleRevertPersonField('display_name')}
            className="mb-1"
            displayClassName="text-3xl font-bold"
          />

          {/* Alternate names */}
          {person.alternateNames && person.alternateNames.length > 0 && (
            <p className="text-sm text-app-text-subtle mt-1">
              Also known as: {person.alternateNames.join(', ')}
            </p>
          )}

          <p className="text-xl text-app-text-muted mt-1">{person.lifespan}</p>

          {/* Scraped data notice */}
          {scrapedData && (
            <p className="text-xs text-app-text-subtle mt-2">
              Last scraped: {new Date(scrapedData.scrapedAt).toLocaleDateString()}
            </p>
          )}

          {/* Canonical ID and External Identities (collapsible) */}
          {canonicalId && (
            <div className="mt-3">
              <button
                onClick={() => setShowIdentities(!showIdentities)}
                className="flex items-center gap-1 text-xs text-app-text-subtle hover:text-app-text-muted transition-colors"
              >
                {showIdentities ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                <Fingerprint size={12} />
                <span className="font-mono">{canonicalId}</span>
              </button>
              {showIdentities && (
                <div className="mt-2 pl-4 border-l-2 border-app-border">
                  <p className="text-xs text-app-text-muted mb-2">External Identities:</p>
                  {externalIdentities.length > 0 ? (
                    <div className="space-y-1">
                      {externalIdentities.map(identity => (
                        <div key={`${identity.source}-${identity.externalId}`} className="flex items-center gap-2 text-xs">
                          <span className="px-1.5 py-0.5 bg-app-card rounded text-app-text-muted capitalize">
                            {identity.source}
                          </span>
                          {identity.url ? (
                            <a
                              href={identity.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-mono text-app-accent hover:underline flex items-center gap-1"
                            >
                              {identity.externalId}
                              <ExternalLink size={10} />
                            </a>
                          ) : (
                            <span className="font-mono text-app-text-secondary">{identity.externalId}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-app-text-subtle">No external identities linked</p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Main content - compact layout */}
      <div className="flex-1 space-y-4">
        {/* Top row: Vital Events + Family side-by-side */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Vital Events - 2 columns */}
          <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            <VitalEventCard
              type="birth"
              data={{ date: person.birth?.date, place: person.birth?.place }}
              overrides={buildVitalEventOverrides('birth')}
              onSaveDate={(value) => handleSaveVitalEventField('birth', 'date', value, person.birth?.date ?? null)}
              onSavePlace={(value) => handleSaveVitalEventField('birth', 'place', value, person.birth?.place ?? null)}
              onRevertDate={() => handleRevertVitalEventField('birth', 'date')}
              onRevertPlace={() => handleRevertVitalEventField('birth', 'place')}
              compact
            />
            <VitalEventCard
              type="death"
              data={{ date: person.death?.date, place: person.death?.place }}
              overrides={buildVitalEventOverrides('death')}
              onSaveDate={(value) => handleSaveVitalEventField('death', 'date', value, person.death?.date ?? null)}
              onSavePlace={(value) => handleSaveVitalEventField('death', 'place', value, person.death?.place ?? null)}
              onRevertDate={() => handleRevertVitalEventField('death', 'date')}
              onRevertPlace={() => handleRevertVitalEventField('death', 'place')}
              compact
            />
            <VitalEventCard
              type="burial"
              data={{ date: person.burial?.date, place: person.burial?.place }}
              overrides={buildVitalEventOverrides('burial')}
              onSaveDate={(value) => handleSaveVitalEventField('burial', 'date', value, person.burial?.date ?? null)}
              onSavePlace={(value) => handleSaveVitalEventField('burial', 'place', value, person.burial?.place ?? null)}
              onRevertDate={() => handleRevertVitalEventField('burial', 'date')}
              onRevertPlace={() => handleRevertVitalEventField('burial', 'place')}
              compact
            />
          </div>

          {/* Family - 1 column */}
          <div className="space-y-3">
            {/* Parents */}
            <div className="bg-app-card rounded-lg border border-app-border p-3">
              <h3 className="flex items-center gap-1.5 text-xs font-semibold text-app-text-secondary mb-2">
                <Users size={14} className="text-app-accent" />
                Parents
              </h3>
              {person.parents.length > 0 ? (
                <div className="space-y-1">
                  {person.parents.map((parentId, idx) => {
                    const parent = parentData[parentId];
                    return (
                      <Link
                        key={parentId}
                        to={`/person/${dbId}/${parentId}`}
                        className="flex items-center justify-between py-1 text-xs hover:text-app-accent"
                      >
                        <span className="text-app-text truncate">{parent?.name || parentId}</span>
                        <span className={`text-xs px-1.5 py-0.5 rounded flex-shrink-0 ${
                          idx === 0 ? 'bg-app-male-subtle text-app-male' : 'bg-app-female-subtle text-app-female'
                        }`}>
                          {idx === 0 ? 'Father' : 'Mother'}
                        </span>
                      </Link>
                    );
                  })}
                </div>
              ) : (
                <p className="text-app-text-subtle text-xs">No parents in database</p>
              )}
            </div>

            {/* Spouses - compact */}
            {person.spouses && person.spouses.length > 0 && (
              <div className="bg-app-card rounded-lg border border-app-border p-3">
                <h3 className="flex items-center gap-1.5 text-xs font-semibold text-app-text-secondary mb-2">
                  <Heart size={14} className="text-pink-400" />
                  Spouse{person.spouses.length > 1 ? 's' : ''}
                </h3>
                <div className="space-y-1">
                  {person.spouses.map(spouseId => {
                    const spouse = spouseData[spouseId];
                    return (
                      <Link
                        key={spouseId}
                        to={`/person/${dbId}/${spouseId}`}
                        className="block py-1 text-xs text-app-text hover:text-app-accent truncate"
                      >
                        {spouse?.name || spouseId}
                      </Link>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Children count */}
            {person.children.length > 0 && (
              <div className="bg-app-card rounded-lg border border-app-border p-3">
                <h3 className="flex items-center gap-1.5 text-xs font-semibold text-app-text-secondary mb-2">
                  <Users size={14} className="text-app-success" />
                  Children ({person.children.length})
                </h3>
                <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto">
                  {person.children.slice(0, 5).map(childId => (
                    <Link
                      key={childId}
                      to={`/person/${dbId}/${childId}`}
                      className="px-2 py-0.5 bg-app-bg rounded text-xs text-app-success hover:bg-app-border truncate max-w-[120px]"
                    >
                      {childId}
                    </Link>
                  ))}
                  {person.children.length > 5 && (
                    <span className="px-2 py-0.5 text-xs text-app-text-subtle">+{person.children.length - 5} more</span>
                  )}
                </div>
              </div>
            )}
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
                onClick={() => {
                  const alias = prompt('Enter new alias:');
                  if (alias?.trim()) handleAddClaim('alias', alias.trim());
                }}
                className="text-xs text-app-accent hover:underline"
              >
                + Add
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {buildClaimsListItems('alias').length > 0 ? (
                buildClaimsListItems('alias').map(item => (
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
                <span className="text-xs text-app-text-subtle">No aliases</span>
              )}
            </div>
          </div>

          {/* Occupations as inline tags */}
          <div className="bg-app-card rounded-lg border border-app-border p-3">
            <div className="flex items-center justify-between mb-2">
              <h3 className="flex items-center gap-1.5 text-xs font-semibold text-app-text-secondary">
                <Briefcase size={14} className="text-app-warning" />
                Occupations
              </h3>
              <button
                onClick={() => {
                  const occupation = prompt('Enter new occupation:');
                  if (occupation?.trim()) handleAddClaim('occupation', occupation.trim());
                }}
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
                <span className="text-xs text-app-text-subtle">No occupations</span>
              )}
            </div>
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

          {/* Unified Platforms & Data Section */}
          <UnifiedPlatformSection
            dbId={dbId!}
            personId={personId!}
            externalId={externalIdentities.find(i => i.source === 'familysearch')?.externalId || person?.externalId}
            augmentation={augmentation}
            hasPhoto={hasPhoto}
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
