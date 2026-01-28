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
import { UploadToAncestryDialog } from './UploadToAncestryDialog';
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

// Compact family member card with photo
interface FamilyMemberCardProps {
  id: string;
  person: PersonWithId | undefined;
  dbId: string;
  hasPhoto: boolean;
  gender?: 'male' | 'female';
}

function FamilyMemberCard({ id, person, dbId, hasPhoto, gender }: FamilyMemberCardProps) {
  const displayName = person?.name || id.slice(0, 8);
  const firstName = displayName.split(' ')[0];
  const lifespan = person?.lifespan;
  // Use person's gender if available, otherwise use the passed gender prop
  const effectiveGender = person?.gender || gender;

  return (
    <Link
      to={`/person/${dbId}/${id}`}
      className="flex items-center gap-2 p-1.5 rounded-lg bg-app-bg/50 hover:bg-app-hover transition-colors group min-w-0"
    >
      {/* Photo or placeholder */}
      {hasPhoto ? (
        <img
          src={api.getPhotoUrl(id)}
          alt={displayName}
          className="w-8 h-8 rounded-full object-cover flex-shrink-0"
        />
      ) : (
        <div className="w-8 h-8 rounded-full bg-app-card flex items-center justify-center flex-shrink-0">
          <User size={14} className="text-app-text-subtle" />
        </div>
      )}
      {/* Name and lifespan */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1">
          <span className="text-xs font-medium text-app-text truncate group-hover:text-app-accent">
            {firstName}
          </span>
          {effectiveGender && effectiveGender !== 'unknown' && (
            <span className={`text-[10px] ${effectiveGender === 'male' ? 'text-app-male' : 'text-app-female'}`}>
              {effectiveGender === 'male' ? '♂' : '♀'}
            </span>
          )}
        </div>
        {lifespan && (
          <span className="text-[10px] text-app-text-subtle truncate block">
            {lifespan}
          </span>
        )}
      </div>
    </Link>
  );
}

export function PersonDetail() {
  const { dbId, personId } = useParams<{ dbId: string; personId: string }>();
  const navigate = useNavigate();
  const { refreshDatabases, expandDatabase } = useSidebar();
  const [person, setPerson] = useState<PersonWithId | null>(null);
  const [parentData, setParentData] = useState<Record<string, PersonWithId>>({});
  const [spouseData, setSpouseData] = useState<Record<string, PersonWithId>>({});
  const [childData, setChildData] = useState<Record<string, PersonWithId>>({});
  const [familyPhotos, setFamilyPhotos] = useState<Record<string, boolean>>({});
  const [database, setDatabase] = useState<DatabaseInfo | null>(null);
  const [lineage, setLineage] = useState<PathResult | null>(null);
  const [, setScrapedData] = useState<LegacyScrapedPersonData | null>(null);
  const [augmentation, setAugmentation] = useState<PersonAugmentation | null>(null);
  const [hasPhoto, setHasPhoto] = useState(false);
  const [hasFsPhoto, setHasFsPhoto] = useState(false);
  const [hasWikiPhoto, setHasWikiPhoto] = useState(false);
  const [hasAncestryPhoto, setHasAncestryPhoto] = useState(false);
  const [photoVersion, setPhotoVersion] = useState(0); // For cache busting
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
  const [showAncestryUploadDialog, setShowAncestryUploadDialog] = useState(false);
  const [showRelationshipModal, setShowRelationshipModal] = useState(false);

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
    setChildData({});
    setFamilyPhotos({});
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

        // Collect all family member IDs for batch photo check
        const allFamilyIds: string[] = [
          ...personData.parents,
          ...(personData.spouses || []),
          ...personData.children,
        ];

        // Fetch parent data
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

        // Fetch spouse data
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

        // Fetch children data
        if (personData.children.length > 0) {
          const childResults = await Promise.all(
            personData.children.map((cid: string) => api.getPerson(dbId, cid).catch(() => null))
          );
          const children: Record<string, PersonWithId> = {};
          childResults.forEach((c: PersonWithId | null, idx: number) => {
            if (c) children[personData.children[idx]] = c;
          });
          setChildData(children);
        }

        // Check photos for all family members (batch)
        if (allFamilyIds.length > 0) {
          const photoChecks = await Promise.all(
            allFamilyIds.map((id: string) => api.hasPhoto(id).then(r => ({ id, exists: r?.exists ?? false })).catch(() => ({ id, exists: false })))
          );
          const photos: Record<string, boolean> = {};
          photoChecks.forEach(({ id, exists }) => { photos[id] = exists; });
          setFamilyPhotos(photos);
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
      await refreshPhotoState();
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

  // Refresh photo state after setting a new primary photo
  const refreshPhotoState = useCallback(async () => {
    if (!personId) return;
    const [photoCheck, wikiPhotoCheck, ancestryPhotoCheck, wikiTreePhotoCheck, linkedInPhotoCheck] = await Promise.all([
      api.hasPhoto(personId).catch(() => ({ exists: false })),
      api.hasWikiPhoto(personId).catch(() => ({ exists: false })),
      api.hasAncestryPhoto(personId).catch(() => ({ exists: false })),
      api.hasWikiTreePhoto(personId).catch(() => ({ exists: false })),
      api.hasLinkedInPhoto(personId).catch(() => ({ exists: false })),
    ]);
    setHasPhoto(photoCheck?.exists ?? false);
    setHasFsPhoto((photoCheck as { exists: boolean; fsExists?: boolean })?.fsExists ?? false);
    setHasWikiPhoto(wikiPhotoCheck?.exists ?? false);
    setHasAncestryPhoto(ancestryPhotoCheck?.exists ?? false);
    setHasWikiTreePhoto(wikiTreePhotoCheck?.exists ?? false);
    setHasLinkedInPhoto(linkedInPhotoCheck?.exists ?? false);
    // Increment photo version to bust browser cache
    setPhotoVersion(Date.now());
  }, [personId]);

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
  // Photo priority: Primary (user-selected) > Ancestry > WikiTree > LinkedIn > Wiki > FamilySearch
  // Add cache-busting timestamp to force refresh after changing photos
  const cacheBuster = photoVersion > 0 ? photoVersion : undefined;
  // Primary photo is at api.getPhotoUrl() - check if it exists by seeing if hasPhoto is true
  // but we need to distinguish between "has primary" vs "has any photo"
  // For now, always show the primary photo URL if hasPhoto is true (getPhotoPath returns primary first)
  const photoUrl = hasPhoto
    ? api.getPhotoUrl(personId!, cacheBuster)
    : hasAncestryPhoto
      ? api.getAncestryPhotoUrl(personId!, cacheBuster)
      : hasWikiTreePhoto
        ? api.getWikiTreePhotoUrl(personId!, cacheBuster)
        : hasLinkedInPhoto
          ? api.getLinkedInPhotoUrl(personId!, cacheBuster)
          : hasWikiPhoto
            ? api.getWikiPhotoUrl(personId!, cacheBuster)
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
      {/* Header - Mobile-friendly layout */}
      <div className="mb-4">
        {/* Mobile: stacked, Desktop: side-by-side */}
        <div className="flex flex-col sm:flex-row gap-4">
          {/* Profile Photo */}
          <div className="flex-shrink-0 flex justify-center sm:justify-start">
            {photoUrl ? (
              <img
                src={photoUrl}
                alt={person.name}
                className="w-28 h-28 sm:w-24 sm:h-24 rounded-lg object-cover border border-app-border"
              />
            ) : (
              <div className="w-28 h-28 sm:w-24 sm:h-24 rounded-lg bg-app-card border border-app-border flex items-center justify-center">
                <User size={36} className="text-app-text-subtle" />
              </div>
            )}
          </div>

          {/* Name, lifespan, and IDs */}
          <div className="flex-1 min-w-0 text-center sm:text-left">
            {/* Name row */}
            <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 mb-1">
              <EditableField
                value={getPersonOverride('display_name')?.overrideValue ?? person.name}
                originalValue={person.name}
                isOverridden={!!getPersonOverride('display_name')}
                onSave={async (value) => { await handleSavePersonField('display_name', value, person.name); }}
                onRevert={async () => { await handleRevertPersonField('display_name'); }}
                displayClassName="text-xl sm:text-2xl font-bold"
                inputClassName="text-xl sm:text-2xl font-bold"
                placeholder="Enter name..."
                className="flex-shrink min-w-0"
              />
              {person.gender && person.gender !== 'unknown' && (
                <span className={`px-2 py-0.5 rounded text-xs ${
                  person.gender === 'male' ? 'bg-app-male-subtle text-app-male' : 'bg-app-female-subtle text-app-female'
                }`}>
                  {person.gender === 'male' ? 'M' : 'F'}
                </span>
              )}
              <FavoriteButton dbId={dbId!} personId={personId!} personName={person.name} />
            </div>

            {/* Lifespan */}
            <p className="text-sm text-app-text-muted mb-2">
              {person.lifespan.endsWith('-') ? `${person.lifespan}Living` : person.lifespan}
            </p>

            {/* IDs - compact grid on mobile */}
            <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 text-xs">
              {canonicalId && (
                <button
                  onClick={() => { navigator.clipboard.writeText(canonicalId); toast.success('Copied ID'); }}
                  className="font-mono flex items-center gap-0.5 text-app-text-subtle hover:text-app-text transition-colors"
                  title={`Copy ${canonicalId}`}
                >
                  {formatIdForDisplay(canonicalId)}
                  <Copy size={10} />
                </button>
              )}
              {fsId && (
                <a
                  href={`https://www.familysearch.org/tree/person/details/${fsId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sky-600 dark:text-sky-400 hover:underline flex items-center gap-0.5"
                >
                  FS: {fsId}
                  <ExternalLink size={10} />
                </a>
              )}
              {ancestryId && (
                <button
                  onClick={() => { navigator.clipboard.writeText(ancestryId); toast.success('Copied Ancestry ID'); }}
                  className="text-emerald-600 dark:text-emerald-400 flex items-center gap-0.5 hover:underline"
                  title={`Copy ${ancestryId}`}
                >
                  Anc: {ancestryId.length > 10 ? `${ancestryId.slice(0, 8)}...` : ancestryId}
                  <Copy size={10} />
                </button>
              )}
              {wikiTreeId && (
                <button
                  onClick={() => { navigator.clipboard.writeText(wikiTreeId); toast.success('Copied WikiTree ID'); }}
                  className="text-purple-600 dark:text-purple-400 flex items-center gap-0.5 hover:underline"
                  title={`Copy ${wikiTreeId}`}
                >
                  WT: {wikiTreeId}
                  <Copy size={10} />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Action buttons - below on mobile, separate row */}
        <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 mt-3 pt-3 border-t border-app-border/50 sm:border-0 sm:pt-0 sm:mt-2">
          {isRoot && (
            <span className="px-2 py-1 bg-app-success/20 text-app-success rounded text-xs font-medium">
              Root Person
            </span>
          )}
          {lineage && !isRoot && (
            <span className="px-2 py-1 bg-app-accent/20 text-app-accent rounded text-xs font-medium">
              {relationship}
            </span>
          )}
          {!lineage && !isRoot && (
            <button
              onClick={calculateLineage}
              disabled={lineageLoading}
              className="px-2 py-1 bg-app-accent/20 text-app-accent rounded text-xs font-medium hover:bg-app-accent/30 transition-colors disabled:opacity-50 flex items-center gap-1"
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
              className="flex items-center gap-1 px-2 py-1 bg-app-success/20 text-app-success rounded text-xs hover:bg-app-success/30 transition-colors disabled:opacity-50"
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
            className="px-2 py-1 text-app-text-muted hover:text-app-accent hover:bg-app-hover rounded flex items-center gap-1 text-xs transition-colors"
          >
            <GitBranch size={12} />
            Tree
          </Link>
        </div>
      </div>

      {/* Main content - compact layout */}
      <div className="flex-1 space-y-3">
        {/* Compact Vital Events + Family */}
        <div className="bg-app-card rounded-lg border border-app-border p-3">
          {/* Vital Events - stack on mobile, row on desktop */}
          <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2 sm:gap-x-6 sm:gap-y-2 text-sm">
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

          {/* Family - Parents/Spouses/Children as compact cards */}
          <div className="mt-3 pt-3 border-t border-app-border/50 grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* Parents */}
            <div className="flex flex-wrap items-start gap-2 md:flex-col md:items-start md:gap-2 md:bg-app-bg/30 md:border md:border-app-border/50 md:rounded-lg md:p-2">
              <div className="flex items-center gap-1 text-xs text-app-text-muted w-16 shrink-0 pt-2 md:w-full md:pt-0 md:pb-1 md:border-b md:border-app-border/40">
                <Users size={12} />
                Parents
              </div>
              {person.parents.length > 0 ? (
                <div className="flex flex-wrap gap-1.5 flex-1">
                  {person.parents.map((parentId, idx) => (
                    <FamilyMemberCard
                      key={parentId}
                      id={parentId}
                      person={parentData[parentId]}
                      dbId={dbId!}
                      hasPhoto={familyPhotos[parentId] ?? false}
                      gender={parentData[parentId]?.gender === 'male' ? 'male' : parentData[parentId]?.gender === 'female' ? 'female' : (idx === 0 ? 'male' : 'female')}
                    />
                  ))}
                </div>
              ) : (
                <span className="text-xs text-app-text-subtle pt-2 md:pt-0">—</span>
              )}
            </div>

            {/* Spouses - filter out self */}
            <div className="flex flex-wrap items-start gap-2 md:flex-col md:items-start md:gap-2 md:bg-app-bg/30 md:border md:border-app-border/50 md:rounded-lg md:p-2">
              <div className="flex items-center justify-between gap-2 text-xs text-app-text-muted w-16 shrink-0 pt-2 md:w-full md:pt-0 md:pb-1 md:border-b md:border-app-border/40">
                <div className="flex items-center gap-1">
                <Heart size={12} />
                Spouse{person.spouses?.filter(id => id !== personId).length && person.spouses.filter(id => id !== personId).length > 1 ? 's' : ''}
                </div>
                <button
                  type="button"
                  className="text-[10px] text-app-accent hover:underline"
                  title="Add or link a spouse"
                  onClick={() => setShowRelationshipModal(true)}
                >
                  + Add
                </button>
              </div>
              {person.spouses && person.spouses.filter(id => id !== personId).length > 0 ? (
                <div className="flex flex-wrap gap-1.5 flex-1">
                  {person.spouses.filter(id => id !== personId).map((spouseId) => (
                    <FamilyMemberCard
                      key={spouseId}
                      id={spouseId}
                      person={spouseData[spouseId]}
                      dbId={dbId!}
                      hasPhoto={familyPhotos[spouseId] ?? false}
                    />
                  ))}
                </div>
              ) : (
                <span className="text-xs text-app-text-subtle pt-2 md:pt-0">None</span>
              )}
            </div>

            {/* Children */}
            <div className="flex flex-wrap items-start gap-2 md:flex-col md:items-start md:gap-2 md:bg-app-bg/30 md:border md:border-app-border/50 md:rounded-lg md:p-2">
              <div className="flex items-center gap-1 text-xs text-app-text-muted w-16 shrink-0 pt-2 md:w-full md:pt-0 md:pb-1 md:border-b md:border-app-border/40">
                <Users size={12} />
                Children
              </div>
              {person.children.length > 0 ? (
                <div className="flex flex-wrap gap-1.5 flex-1">
                  {person.children.map((childId) => (
                    <FamilyMemberCard
                      key={childId}
                      id={childId}
                      person={childData[childId]}
                      dbId={dbId!}
                      hasPhoto={familyPhotos[childId] ?? false}
                    />
                  ))}
                </div>
              ) : (
                <span className="text-xs text-app-text-subtle pt-2 md:pt-0">None</span>
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
              birthPlace: buildVitalEventOverrides('birth').place?.value ?? person.birth?.place ?? undefined,
              deathDate: buildVitalEventOverrides('death').date?.value ?? person.death?.date ?? undefined,
              deathPlace: buildVitalEventOverrides('death').place?.value ?? person.death?.place ?? undefined,
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
            photoCacheBuster={cacheBuster}
            onSyncFromFamilySearch={handleSyncFromFamilySearch}
            onScrapePhoto={handleScrape}
            onFetchPhoto={handleFetchPhotoFromPlatform}
            onShowUploadDialog={() => setShowUploadDialog(true)}
            onShowAncestryUploadDialog={() => setShowAncestryUploadDialog(true)}
            onShowLinkInput={(platform) => setLinkingPlatform(platform)}
            onPhotoChanged={refreshPhotoState}
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

      {/* Upload to Ancestry Dialog */}
      {showAncestryUploadDialog && dbId && personId && (
        <UploadToAncestryDialog
          dbId={dbId}
          personId={personId}
          onClose={() => setShowAncestryUploadDialog(false)}
        />
      )}

      {/* Link Platform Dialog */}
      <LinkPlatformDialog
        platform={linkingPlatform}
        onClose={() => setLinkingPlatform(null)}
        onLink={handleLinkPlatform}
        loading={linkingLoading}
      />

      {/* Relationship placeholder modal */}
      {showRelationshipModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={(e) => e.target === e.currentTarget && setShowRelationshipModal(false)}
        >
          <div className="bg-app-card rounded-lg border border-app-border shadow-xl max-w-md w-full mx-4">
            <div className="flex items-center justify-between px-4 py-3 border-b border-app-border">
              <h3 className="font-semibold text-app-text">Add Relationship</h3>
              <button
                onClick={() => setShowRelationshipModal(false)}
                className="p-1 text-app-text-muted hover:text-app-text hover:bg-app-hover rounded transition-colors"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <p className="text-sm text-app-text-muted">
                Coming soon: link existing people or create new profiles for parents, spouses, and children.
              </p>
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => setShowRelationshipModal(false)}
                  className="px-3 py-1.5 text-sm text-app-text-secondary hover:bg-app-hover rounded transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
