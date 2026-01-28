import { useState, useEffect, useRef } from 'react';
import { ExternalLink, Download, Upload, Camera, Link2, Loader2, Check, AlertCircle, User, Search, ArrowRight } from 'lucide-react';
import toast from 'react-hot-toast';
import type { PersonAugmentation, MultiPlatformComparison, BuiltInProvider, ComparisonStatus } from '@fsf/shared';
import { api } from '../../services/api';

interface ProviderDataTableProps {
  dbId: string;
  personId: string;
  localData: {
    name: string;
    birthDate?: string;
    birthPlace?: string;
    deathDate?: string;
    deathPlace?: string;
    fatherName?: string;
    motherName?: string;
    bio?: string;
    occupations?: string[];
    alternateNames?: string[];
    childrenCount?: number;
  };
  externalId?: string;
  augmentation: PersonAugmentation | null;
  hasPhoto: boolean;
  hasFsPhoto: boolean;
  hasWikiPhoto: boolean;
  hasAncestryPhoto: boolean;
  hasWikiTreePhoto: boolean;
  hasLinkedInPhoto: boolean;
  onSyncFromFamilySearch: () => Promise<void>;
  onScrapePhoto: () => Promise<void>;
  onFetchPhoto: (platform: string) => Promise<void>;
  onShowUploadDialog: () => void;
  onShowAncestryUploadDialog: () => void;
  onShowLinkInput: (platform: 'wikipedia' | 'ancestry' | 'wikitree' | 'linkedin') => void;
  onPhotoChanged?: () => void;  // Called when primary photo changes to refresh parent state
  syncLoading: boolean;
  scrapeLoading: boolean;
  fetchingPhotoFrom: string | null;
}

// Provider display info
const PROVIDER_INFO: Record<string, { name: string; color: string; bgColor: string }> = {
  sparsetree: { name: 'SparseTree', color: 'text-app-accent', bgColor: 'bg-app-accent/10' },
  familysearch: { name: 'FamilySearch', color: 'text-sky-600 dark:text-sky-400', bgColor: 'bg-sky-600/10' },
  ancestry: { name: 'Ancestry', color: 'text-emerald-600 dark:text-emerald-400', bgColor: 'bg-emerald-600/10' },
  wikitree: { name: 'WikiTree', color: 'text-purple-600 dark:text-purple-400', bgColor: 'bg-purple-600/10' },
  wikipedia: { name: 'Wikipedia', color: 'text-blue-600 dark:text-blue-400', bgColor: 'bg-blue-600/10' },
  linkedin: { name: 'LinkedIn', color: 'text-[#0A66C2] dark:text-[#5BA3E6]', bgColor: 'bg-[#0A66C2]/10' },
};

function StatusIcon({ status }: { status: ComparisonStatus }) {
  switch (status) {
    case 'match':
      return <Check size={12} className="text-green-500" />;
    case 'different':
      return <AlertCircle size={12} className="text-amber-500" />;
    default:
      return null; // No icon for missing data
  }
}

function PhotoThumbnail({
  src,
  alt,
  onUsePhoto,
  onSetPrimary,
  loading,
  showUseButton = false,
  showSetPrimaryButton = false,
  isPrimary = false,
}: {
  src: string | null;
  alt: string;
  onUsePhoto?: () => void;
  onSetPrimary?: () => void;
  loading?: boolean;
  showUseButton?: boolean;
  showSetPrimaryButton?: boolean;
  isPrimary?: boolean;
}) {
  if (!src) {
    return (
      <div className="w-8 h-8 rounded bg-app-bg border border-app-border flex items-center justify-center">
        <User size={14} className="text-app-text-subtle" />
      </div>
    );
  }

  // Determine which action to show: download (fetch) or use as primary
  const showAction = showUseButton || showSetPrimaryButton;
  const handleClick = showSetPrimaryButton ? onSetPrimary : onUsePhoto;
  const buttonTitle = showSetPrimaryButton ? "Use as primary" : "Fetch this photo";

  return (
    <div className="relative group">
      <img
        src={src}
        alt={alt}
        className={`w-8 h-8 rounded object-cover border ${isPrimary ? 'border-app-accent ring-1 ring-app-accent' : 'border-app-border'}`}
      />
      {showAction && handleClick && (
        <button
          onClick={handleClick}
          disabled={loading}
          className="absolute inset-0 flex items-center justify-center bg-black/50 rounded opacity-0 group-hover:opacity-100 transition-opacity"
          title={buttonTitle}
        >
          {loading ? (
            <Loader2 size={12} className="animate-spin text-white" />
          ) : showSetPrimaryButton ? (
            <ArrowRight size={12} className="text-white" />
          ) : (
            <Camera size={12} className="text-white" />
          )}
        </button>
      )}
    </div>
  );
}

export function ProviderDataTable({
  dbId,
  personId,
  localData,
  externalId,
  augmentation,
  hasPhoto,
  hasFsPhoto,
  hasWikiPhoto,
  hasAncestryPhoto,
  hasWikiTreePhoto,
  hasLinkedInPhoto,
  onSyncFromFamilySearch,
  onScrapePhoto,
  onFetchPhoto,
  onShowUploadDialog,
  onShowAncestryUploadDialog,
  onShowLinkInput,
  onPhotoChanged,
  syncLoading,
  scrapeLoading,
  fetchingPhotoFrom,
}: ProviderDataTableProps) {
  const [comparison, setComparison] = useState<MultiPlatformComparison | null>(null);
  const [refreshingProvider, setRefreshingProvider] = useState<string | null>(null);
  const [discoveringProvider, setDiscoveringProvider] = useState<string | null>(null);
  const [discoveringAll, setDiscoveringAll] = useState<BuiltInProvider | null>(null);
  const [applyingField, setApplyingField] = useState<string | null>(null); // Track which field is being applied
  const prevSyncLoading = useRef(syncLoading);

  // Load comparison data
  useEffect(() => {
    api.getMultiPlatformComparison(dbId, personId)
      .then(setComparison)
      .catch(() => null);
  }, [dbId, personId]);

  // Reload comparison after FamilySearch download completes
  useEffect(() => {
    if (prevSyncLoading.current && !syncLoading) {
      api.getMultiPlatformComparison(dbId, personId)
        .then(setComparison)
        .catch(() => null);
    }
    prevSyncLoading.current = syncLoading;
  }, [syncLoading, dbId, personId]);

  const handleRefreshProvider = async (provider: BuiltInProvider) => {
    setRefreshingProvider(provider);
    const result = await api.refreshFromProvider(dbId, personId, provider).catch(err => {
      toast.error(`Failed to refresh from ${PROVIDER_INFO[provider]?.name || provider}: ${err.message}`);
      return null;
    });

    if (result) {
      toast.success(`Refreshed data from ${PROVIDER_INFO[provider]?.name || provider}`);
      // Reload comparison
      const newComparison = await api.getMultiPlatformComparison(dbId, personId).catch(() => null);
      if (newComparison) setComparison(newComparison);

      // Also fetch photo from the provider as part of download
      await onFetchPhoto(provider).catch(() => null);
    }
    setRefreshingProvider(null);
  };

  const handleDiscoverParents = async (provider: BuiltInProvider) => {
    setDiscoveringProvider(provider);
    const result = await api.discoverParentIds(dbId, personId, provider).catch(err => {
      toast.error(`Discovery failed: ${err.message}`);
      return null;
    });

    if (result) {
      if (result.discovered.length > 0) {
        const names = result.discovered.map(d => `${d.parentRole}: ${d.parentName}`).join(', ');
        toast.success(`Discovered ${result.discovered.length} parent link${result.discovered.length !== 1 ? 's' : ''} on ${PROVIDER_INFO[provider]?.name || provider} (${names})`);
      } else if (result.error) {
        toast.error(result.error);
      } else {
        toast(`No new parent links to discover on ${PROVIDER_INFO[provider]?.name || provider}`);
      }
      // Reload comparison
      const newComparison = await api.getMultiPlatformComparison(dbId, personId).catch(() => null);
      if (newComparison) setComparison(newComparison);
    }
    setDiscoveringProvider(null);
  };

  const handleDiscoverAll = async (provider: BuiltInProvider) => {
    setDiscoveringAll(provider);
    toast(`Starting ancestor discovery on ${PROVIDER_INFO[provider]?.name || provider}...`);

    const result = await api.discoverAncestorIds(dbId, personId, provider).catch(err => {
      toast.error(`Ancestor discovery failed: ${err.message}`);
      return null;
    });

    if (result) {
      if (result.totalDiscovered > 0) {
        toast.success(`Discovered ${result.totalDiscovered} link${result.totalDiscovered !== 1 ? 's' : ''} on ${PROVIDER_INFO[provider]?.name || provider}, traversed ${result.generationsTraversed} generation${result.generationsTraversed !== 1 ? 's' : ''}`);
      } else {
        toast(`No new ancestor links discovered on ${PROVIDER_INFO[provider]?.name || provider}`);
      }
      // Reload comparison
      const newComparison = await api.getMultiPlatformComparison(dbId, personId).catch(() => null);
      if (newComparison) setComparison(newComparison);
    }
    setDiscoveringAll(null);
  };

  // Handle "Use" button - apply a field value from provider data
  const handleUseValue = async (fieldName: string, provider: BuiltInProvider, value: string | null) => {
    if (!value) return;

    const fieldKey = `${fieldName}-${provider}`;
    setApplyingField(fieldKey);

    // Handle parent fields specially - they create edges, not overrides
    if (fieldName === 'fatherName' || fieldName === 'motherName') {
      const parentType = fieldName === 'fatherName' ? 'father' : 'mother';
      const result = await api.useProviderParent(dbId, personId, parentType, provider).catch(err => {
        toast.error(`Failed to apply ${parentType} from ${PROVIDER_INFO[provider]?.name || provider}: ${err.message}`);
        return null;
      });

      if (result) {
        toast.success(`Applied ${parentType} link from ${PROVIDER_INFO[provider]?.name || provider}: ${result.parentName}`);
        // Reload comparison
        const newComparison = await api.getMultiPlatformComparison(dbId, personId).catch(() => null);
        if (newComparison) setComparison(newComparison);
      }
    } else {
      // Regular fields use local override system
      const result = await api.useProviderField(dbId, personId, fieldName, provider, value).catch(err => {
        toast.error(`Failed to apply ${fieldName} from ${PROVIDER_INFO[provider]?.name || provider}: ${err.message}`);
        return null;
      });

      if (result) {
        toast.success(`Applied ${fieldName} from ${PROVIDER_INFO[provider]?.name || provider}`);
        // Reload comparison
        const newComparison = await api.getMultiPlatformComparison(dbId, personId).catch(() => null);
        if (newComparison) setComparison(newComparison);
      }
    }

    setApplyingField(null);
  };

  // Handle "Use" photo - set provider photo as primary
  const handleUsePhoto = async (provider: BuiltInProvider) => {
    const fieldKey = `photo-${provider}`;
    setApplyingField(fieldKey);

    const result = await api.useProviderPhoto(dbId, personId, provider).catch(err => {
      toast.error(`Failed to set ${PROVIDER_INFO[provider]?.name || provider} photo as primary: ${err.message}`);
      return null;
    });

    if (result) {
      toast.success(`Set ${PROVIDER_INFO[provider]?.name || provider} photo as primary`);
      // Notify parent to refresh photo state
      onPhotoChanged?.();
    }

    setApplyingField(null);
  };

  // Get platform info from augmentation
  const wikiPlatform = augmentation?.platforms?.find(p => p.platform === 'wikipedia');
  const ancestryPlatform = augmentation?.platforms?.find(p => p.platform === 'ancestry');
  const wikiTreePlatform = augmentation?.platforms?.find(p => p.platform === 'wikitree');
  const linkedInPlatform = augmentation?.platforms?.find(p => p.platform === 'linkedin');

  // Build FamilySearch URL
  const fsId = externalId || personId;
  const fsUrl = `https://www.familysearch.org/tree/person/details/${fsId}`;

  // Get field values from comparison data
  const getProviderValue = (provider: string, fieldName: string): { value: string | null; status: ComparisonStatus; url?: string } => {
    if (!comparison) return { value: null, status: 'missing_provider' };
    const field = comparison.fields.find(f => f.fieldName === fieldName);
    if (!field) return { value: null, status: 'missing_provider' };
    const pv = field.providerValues[provider];
    return pv || { value: null, status: 'missing_provider' };
  };

  // Get local URL for a field (e.g., parent links to SparseTree person page)
  const getLocalUrl = (fieldName: string): string | undefined => {
    if (!comparison) return undefined;
    return comparison.fields.find(f => f.fieldName === fieldName)?.localUrl;
  };

  // Render a provider field value, linking it when a URL is available
  // Includes "Use" button for differing values
  const renderProviderValue = (provider: string, fieldName: string, showUseButton = true) => {
    const pv = getProviderValue(provider, fieldName);
    if (!pv.value) return '';
    const colorClass = pv.status === 'different' ? 'text-amber-600 dark:text-amber-400' : 'text-app-text';
    const isExternal = pv.url?.startsWith('http');
    const fieldKey = `${fieldName}-${provider}`;
    const isApplying = applyingField === fieldKey;

    // Show "Use" button for differing or missing local values
    const canUse = showUseButton && (pv.status === 'different' || pv.status === 'missing_local') && pv.value;

    return (
      <span className="inline-flex items-center gap-1">
        {pv.url ? (
          <a href={pv.url} {...(isExternal ? { target: '_blank', rel: 'noopener noreferrer' } : {})} className={`${colorClass} hover:underline`}>{pv.value}</a>
        ) : (
          <span className={colorClass}>{pv.value}</span>
        )}
        {pv.status === 'different' && <StatusIcon status="different" />}
        {canUse && (
          <button
            onClick={() => handleUseValue(fieldName, provider as BuiltInProvider, pv.value)}
            disabled={isApplying}
            className="ml-0.5 px-1 py-0 rounded text-[10px] bg-app-accent/20 text-app-accent hover:bg-app-accent/30 disabled:opacity-50"
            title={`Use this value from ${PROVIDER_INFO[provider]?.name || provider}`}
          >
            {isApplying ? <Loader2 size={8} className="animate-spin" /> : <ArrowRight size={8} />}
          </button>
        )}
      </span>
    );
  };

  // Count differences for a provider
  const getDifferenceCount = (provider: string): number => {
    if (!comparison) return 0;
    return comparison.fields.filter(f => f.providerValues[provider]?.status === 'different').length;
  };

  // Provider photo URLs
  // SparseTree row always shows the primary (user-selected) photo - this is our source of truth
  const sparseTreePhotoUrl = hasPhoto ? api.getPhotoUrl(personId) : null;

  const fsPhotoUrl = hasFsPhoto ? api.getFsPhotoUrl(personId) : null;
  const ancestryPhotoUrl = hasAncestryPhoto ? api.getAncestryPhotoUrl(personId) : null;
  const wikiTreePhotoUrl = hasWikiTreePhoto ? api.getWikiTreePhotoUrl(personId) : null;
  const wikiPhotoUrl = hasWikiPhoto ? api.getWikiPhotoUrl(personId) : null;
  const linkedInPhotoUrl = hasLinkedInPhoto ? api.getLinkedInPhotoUrl(personId) : null;

  // Check if a provider needs parent discovery
  const needsDiscovery = (provider: string): boolean => {
    if (!comparison) return false;
    const p = comparison.providers.find(pr => pr.provider === provider);
    return p?.isLinked === true && p?.parentsNeedDiscovery === true;
  };

  // Providers that support discovery
  const discoveryProviders: BuiltInProvider[] = ['familysearch', 'ancestry', 'wikitree'];

  // Check if any provider needs discovery (for Discover All button)
  const anyNeedsDiscovery = discoveryProviders.some(p => needsDiscovery(p));

  // Get linked providers from comparison
  const linkedProviders = comparison?.providers.filter(p => p.isLinked) || [];

  return (
    <div className="bg-app-card rounded-lg border border-app-border">
      {/* Header */}
      <div className="px-4 py-2 border-b border-app-border">
        <h3 className="text-sm font-semibold text-app-text-secondary">Provider Data</h3>
      </div>

      {/* Provider Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-app-bg/30 text-left">
              <th className="px-2 py-1.5 font-medium text-app-text-muted text-xs">Source</th>
              <th className="px-2 py-1.5 font-medium text-app-text-muted text-xs w-10">Photo</th>
              <th className="px-2 py-1.5 font-medium text-app-text-muted text-xs">Name</th>
              <th className="px-2 py-1.5 font-medium text-app-text-muted text-xs">Birth Date</th>
              <th className="px-2 py-1.5 font-medium text-app-text-muted text-xs">Birth Place</th>
              <th className="px-2 py-1.5 font-medium text-app-text-muted text-xs">Death Date</th>
              <th className="px-2 py-1.5 font-medium text-app-text-muted text-xs">Death Place</th>
              <th className="px-2 py-1.5 font-medium text-app-text-muted text-xs">Father</th>
              <th className="px-2 py-1.5 font-medium text-app-text-muted text-xs">Mother</th>
              <th className="px-2 py-1.5 font-medium text-app-text-muted text-xs">Status</th>
              <th className="px-2 py-1.5 font-medium text-app-text-muted text-xs text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {/* SparseTree - Primary row */}
            <tr className="border-t border-app-border/50 bg-app-accent/5">
              <td className="px-2 py-1.5">
                <span className={`font-medium text-xs ${PROVIDER_INFO.sparsetree.color}`}>
                  SparseTree
                </span>
              </td>
              <td className="px-2 py-1.5">
                <PhotoThumbnail src={sparseTreePhotoUrl} alt={localData.name} />
              </td>
              <td className="px-2 py-1.5 text-app-text font-medium text-xs">{localData.name}</td>
              <td className="px-2 py-1.5 text-app-text text-xs">{localData.birthDate || ''}</td>
              <td className="px-2 py-1.5 text-app-text text-xs max-w-[120px] truncate" title={localData.birthPlace}>{localData.birthPlace || ''}</td>
              <td className="px-2 py-1.5 text-app-text text-xs">{localData.deathDate || 'Living'}</td>
              <td className="px-2 py-1.5 text-app-text text-xs max-w-[120px] truncate" title={localData.deathPlace}>{localData.deathPlace || ''}</td>
              <td className="px-2 py-1.5 text-app-text text-xs">
                {localData.fatherName ? (
                  getLocalUrl('fatherName') ? <a href={getLocalUrl('fatherName')} className="text-app-accent hover:underline">{localData.fatherName}</a> : localData.fatherName
                ) : ''}
              </td>
              <td className="px-2 py-1.5 text-app-text text-xs">
                {localData.motherName ? (
                  getLocalUrl('motherName') ? <a href={getLocalUrl('motherName')} className="text-app-accent hover:underline">{localData.motherName}</a> : localData.motherName
                ) : ''}
              </td>
              <td className="px-2 py-1.5">
                <span className="text-xs text-app-accent font-medium">Primary</span>
              </td>
              <td className="px-2 py-1.5 text-right">
              </td>
            </tr>

            {/* FamilySearch */}
            <tr className="border-t border-app-border/50 hover:bg-app-hover/30">
              <td className="px-2 py-1.5">
                <a
                  href={fsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`inline-flex items-center gap-1 text-xs ${PROVIDER_INFO.familysearch.color} hover:opacity-80`}
                >
                  FamilySearch
                  <ExternalLink size={10} />
                </a>
              </td>
              <td className="px-2 py-1.5">
                <PhotoThumbnail
                  src={fsPhotoUrl}
                  alt="FamilySearch photo"
                  onUsePhoto={onScrapePhoto}
                  onSetPrimary={() => handleUsePhoto('familysearch')}
                  loading={scrapeLoading || applyingField === 'photo-familysearch'}
                  showUseButton={!hasFsPhoto}
                  showSetPrimaryButton={hasFsPhoto}
                />
              </td>
              <td className="px-2 py-1.5 text-xs">{renderProviderValue('familysearch', 'name')}</td>
              <td className="px-2 py-1.5 text-xs">{renderProviderValue('familysearch', 'birthDate')}</td>
              <td className="px-2 py-1.5 text-xs max-w-[120px] truncate">{renderProviderValue('familysearch', 'birthPlace')}</td>
              <td className="px-2 py-1.5 text-xs">{renderProviderValue('familysearch', 'deathDate')}</td>
              <td className="px-2 py-1.5 text-xs max-w-[120px] truncate">{renderProviderValue('familysearch', 'deathPlace')}</td>
              <td className="px-2 py-1.5 text-xs">{renderProviderValue('familysearch', 'fatherName')}</td>
              <td className="px-2 py-1.5 text-xs">{renderProviderValue('familysearch', 'motherName')}</td>
              <td className="px-2 py-1.5">
                <span className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
                  <Check size={10} /> Linked
                </span>
              </td>
              <td className="px-2 py-1.5">
                <div className="flex items-center justify-end gap-1">
                  <button
                    onClick={onSyncFromFamilySearch}
                    disabled={syncLoading}
                    className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs ${PROVIDER_INFO.familysearch.bgColor} ${PROVIDER_INFO.familysearch.color} hover:opacity-80 disabled:opacity-50`}
                    title="Download from FamilySearch (includes photo)"
                  >
                    {syncLoading ? <Loader2 size={10} className="animate-spin" /> : <Download size={10} />}
                  </button>
                  <button
                    onClick={onShowUploadDialog}
                    className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs ${PROVIDER_INFO.familysearch.bgColor} ${PROVIDER_INFO.familysearch.color} hover:opacity-80`}
                    title="Upload to FamilySearch"
                  >
                    <Upload size={10} />
                  </button>
                  {needsDiscovery('familysearch') && (
                    <button
                      onClick={() => handleDiscoverParents('familysearch')}
                      disabled={discoveringProvider === 'familysearch'}
                      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs ${PROVIDER_INFO.familysearch.bgColor} ${PROVIDER_INFO.familysearch.color} hover:opacity-80 disabled:opacity-50`}
                      title="Discover parent FamilySearch IDs"
                    >
                      {discoveringProvider === 'familysearch' ? <Loader2 size={10} className="animate-spin" /> : <Search size={10} />}
                    </button>
                  )}
                </div>
              </td>
            </tr>

            {/* Ancestry */}
            <tr className="border-t border-app-border/50 hover:bg-app-hover/30">
              <td className="px-2 py-1.5">
                {ancestryPlatform ? (
                  <a
                    href={ancestryPlatform.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`inline-flex items-center gap-1 text-xs ${PROVIDER_INFO.ancestry.color} hover:opacity-80`}
                  >
                    Ancestry
                    <ExternalLink size={10} />
                  </a>
                ) : (
                  <span className="text-app-text-muted text-xs">Ancestry</span>
                )}
              </td>
              <td className="px-2 py-1.5">
                <PhotoThumbnail
                  src={ancestryPhotoUrl}
                  alt="Ancestry photo"
                  onUsePhoto={() => onFetchPhoto('ancestry')}
                  onSetPrimary={() => handleUsePhoto('ancestry')}
                  loading={fetchingPhotoFrom === 'ancestry' || applyingField === 'photo-ancestry'}
                  showUseButton={!!ancestryPlatform && !hasAncestryPhoto}
                  showSetPrimaryButton={hasAncestryPhoto}
                />
              </td>
              <td className="px-2 py-1.5 text-xs">{ancestryPlatform && renderProviderValue('ancestry', 'name')}</td>
              <td className="px-2 py-1.5 text-xs">{ancestryPlatform && renderProviderValue('ancestry', 'birthDate')}</td>
              <td className="px-2 py-1.5 text-xs max-w-[120px] truncate">{ancestryPlatform && renderProviderValue('ancestry', 'birthPlace')}</td>
              <td className="px-2 py-1.5 text-xs">{ancestryPlatform && renderProviderValue('ancestry', 'deathDate')}</td>
              <td className="px-2 py-1.5 text-xs max-w-[120px] truncate">{ancestryPlatform && renderProviderValue('ancestry', 'deathPlace')}</td>
              <td className="px-2 py-1.5 text-xs">{ancestryPlatform && renderProviderValue('ancestry', 'fatherName')}</td>
              <td className="px-2 py-1.5 text-xs">{ancestryPlatform && renderProviderValue('ancestry', 'motherName')}</td>
              <td className="px-2 py-1.5">
                {ancestryPlatform ? (
                  getDifferenceCount('ancestry') > 0 ? (
                    <span className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                      <AlertCircle size={10} /> {getDifferenceCount('ancestry')} diff
                    </span>
                  ) : (
                    <span className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
                      <Check size={10} /> Linked
                    </span>
                  )
                ) : (
                  <span className="text-xs text-app-text-subtle">Not linked</span>
                )}
              </td>
              <td className="px-2 py-1.5">
                <div className="flex items-center justify-end gap-1">
                  {ancestryPlatform ? (
                    <>
                      <button
                        onClick={() => handleRefreshProvider('ancestry')}
                        disabled={refreshingProvider === 'ancestry'}
                        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs ${PROVIDER_INFO.ancestry.bgColor} ${PROVIDER_INFO.ancestry.color} hover:opacity-80 disabled:opacity-50`}
                        title="Download from Ancestry (includes photo)"
                      >
                        {refreshingProvider === 'ancestry' ? <Loader2 size={10} className="animate-spin" /> : <Download size={10} />}
                      </button>
                      <button
                        onClick={onShowAncestryUploadDialog}
                        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs ${PROVIDER_INFO.ancestry.bgColor} ${PROVIDER_INFO.ancestry.color} hover:opacity-80`}
                        title="Upload photo to Ancestry"
                      >
                        <Upload size={10} />
                      </button>
                      {needsDiscovery('ancestry') && (
                        <button
                          onClick={() => handleDiscoverParents('ancestry')}
                          disabled={discoveringProvider === 'ancestry'}
                          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs ${PROVIDER_INFO.ancestry.bgColor} ${PROVIDER_INFO.ancestry.color} hover:opacity-80 disabled:opacity-50`}
                          title="Discover parent Ancestry IDs"
                        >
                          {discoveringProvider === 'ancestry' ? <Loader2 size={10} className="animate-spin" /> : <Search size={10} />}
                        </button>
                      )}
                    </>
                  ) : (
                    <button
                      onClick={() => onShowLinkInput('ancestry')}
                      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs ${PROVIDER_INFO.ancestry.bgColor} ${PROVIDER_INFO.ancestry.color} hover:opacity-80`}
                      title="Link Ancestry profile"
                    >
                      <Link2 size={10} /> Link
                    </button>
                  )}
                </div>
              </td>
            </tr>

            {/* WikiTree */}
            <tr className="border-t border-app-border/50 hover:bg-app-hover/30">
              <td className="px-2 py-1.5">
                {wikiTreePlatform ? (
                  <a
                    href={wikiTreePlatform.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`inline-flex items-center gap-1 text-xs ${PROVIDER_INFO.wikitree.color} hover:opacity-80`}
                  >
                    WikiTree
                    <ExternalLink size={10} />
                  </a>
                ) : (
                  <span className="text-app-text-muted text-xs">WikiTree</span>
                )}
              </td>
              <td className="px-2 py-1.5">
                <PhotoThumbnail
                  src={wikiTreePhotoUrl}
                  alt="WikiTree photo"
                  onUsePhoto={() => onFetchPhoto('wikitree')}
                  onSetPrimary={() => handleUsePhoto('wikitree')}
                  loading={fetchingPhotoFrom === 'wikitree' || applyingField === 'photo-wikitree'}
                  showUseButton={!!wikiTreePlatform && !hasWikiTreePhoto}
                  showSetPrimaryButton={hasWikiTreePhoto}
                />
              </td>
              <td className="px-2 py-1.5 text-xs">{wikiTreePlatform && renderProviderValue('wikitree', 'name')}</td>
              <td className="px-2 py-1.5 text-xs">{wikiTreePlatform && renderProviderValue('wikitree', 'birthDate')}</td>
              <td className="px-2 py-1.5 text-xs max-w-[120px] truncate">{wikiTreePlatform && renderProviderValue('wikitree', 'birthPlace')}</td>
              <td className="px-2 py-1.5 text-xs">{wikiTreePlatform && renderProviderValue('wikitree', 'deathDate')}</td>
              <td className="px-2 py-1.5 text-xs max-w-[120px] truncate">{wikiTreePlatform && renderProviderValue('wikitree', 'deathPlace')}</td>
              <td className="px-2 py-1.5 text-xs">{wikiTreePlatform && renderProviderValue('wikitree', 'fatherName')}</td>
              <td className="px-2 py-1.5 text-xs">{wikiTreePlatform && renderProviderValue('wikitree', 'motherName')}</td>
              <td className="px-2 py-1.5">
                {wikiTreePlatform ? (
                  <span className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
                    <Check size={10} /> Linked
                  </span>
                ) : (
                  <span className="text-xs text-app-text-subtle">Not linked</span>
                )}
              </td>
              <td className="px-2 py-1.5">
                <div className="flex items-center justify-end gap-1">
                  {wikiTreePlatform ? (
                    <>
                      <button
                        onClick={() => handleRefreshProvider('wikitree')}
                        disabled={refreshingProvider === 'wikitree'}
                        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs ${PROVIDER_INFO.wikitree.bgColor} ${PROVIDER_INFO.wikitree.color} hover:opacity-80 disabled:opacity-50`}
                        title="Download from WikiTree (includes photo)"
                      >
                        {refreshingProvider === 'wikitree' ? <Loader2 size={10} className="animate-spin" /> : <Download size={10} />}
                      </button>
                      {needsDiscovery('wikitree') && (
                        <button
                          onClick={() => handleDiscoverParents('wikitree')}
                          disabled={discoveringProvider === 'wikitree'}
                          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs ${PROVIDER_INFO.wikitree.bgColor} ${PROVIDER_INFO.wikitree.color} hover:opacity-80 disabled:opacity-50`}
                          title="Discover parent WikiTree IDs"
                        >
                          {discoveringProvider === 'wikitree' ? <Loader2 size={10} className="animate-spin" /> : <Search size={10} />}
                        </button>
                      )}
                    </>
                  ) : (
                    <button
                      onClick={() => onShowLinkInput('wikitree')}
                      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs ${PROVIDER_INFO.wikitree.bgColor} ${PROVIDER_INFO.wikitree.color} hover:opacity-80`}
                      title="Link WikiTree profile"
                    >
                      <Link2 size={10} /> Link
                    </button>
                  )}
                </div>
              </td>
            </tr>

            {/* Wikipedia */}
            <tr className="border-t border-app-border/50 hover:bg-app-hover/30">
              <td className="px-2 py-1.5">
                {wikiPlatform ? (
                  <a
                    href={wikiPlatform.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`inline-flex items-center gap-1 text-xs ${PROVIDER_INFO.wikipedia.color} hover:opacity-80`}
                  >
                    Wikipedia
                    <ExternalLink size={10} />
                  </a>
                ) : (
                  <span className="text-app-text-muted text-xs">Wikipedia</span>
                )}
              </td>
              <td className="px-2 py-1.5">
                <PhotoThumbnail
                  src={wikiPhotoUrl}
                  alt="Wikipedia photo"
                  onUsePhoto={() => onFetchPhoto('wikipedia')}
                  loading={fetchingPhotoFrom === 'wikipedia'}
                  showUseButton={!!wikiPlatform && !hasWikiPhoto}
                  showSetPrimaryButton={false}
                />
              </td>
              <td className="px-2 py-1.5 text-xs"></td>
              <td className="px-2 py-1.5 text-xs"></td>
              <td className="px-2 py-1.5 text-xs"></td>
              <td className="px-2 py-1.5 text-xs"></td>
              <td className="px-2 py-1.5 text-xs"></td>
              <td className="px-2 py-1.5 text-xs"></td>
              <td className="px-2 py-1.5 text-xs"></td>
              <td className="px-2 py-1.5">
                {wikiPlatform ? (
                  <span className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
                    <Check size={10} /> Linked
                  </span>
                ) : (
                  <span className="text-xs text-app-text-subtle">Not linked</span>
                )}
              </td>
              <td className="px-2 py-1.5">
                <div className="flex items-center justify-end gap-1">
                  {!wikiPlatform && (
                    <button
                      onClick={() => onShowLinkInput('wikipedia')}
                      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs ${PROVIDER_INFO.wikipedia.bgColor} ${PROVIDER_INFO.wikipedia.color} hover:opacity-80`}
                      title="Link Wikipedia article"
                    >
                      <Link2 size={10} /> Link
                    </button>
                  )}
                </div>
              </td>
            </tr>

            {/* LinkedIn */}
            <tr className="border-t border-app-border/50 hover:bg-app-hover/30">
              <td className="px-2 py-1.5">
                {linkedInPlatform ? (
                  <a
                    href={linkedInPlatform.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`inline-flex items-center gap-1 text-xs ${PROVIDER_INFO.linkedin.color} hover:opacity-80`}
                  >
                    LinkedIn
                    <ExternalLink size={10} />
                  </a>
                ) : (
                  <span className="text-app-text-muted text-xs">LinkedIn</span>
                )}
              </td>
              <td className="px-2 py-1.5">
                <PhotoThumbnail
                  src={linkedInPhotoUrl}
                  alt="LinkedIn photo"
                  onUsePhoto={() => onFetchPhoto('linkedin')}
                  loading={fetchingPhotoFrom === 'linkedin'}
                  showUseButton={!!linkedInPlatform && !hasLinkedInPhoto}
                  showSetPrimaryButton={false}
                />
              </td>
              <td className="px-2 py-1.5 text-xs"></td>
              <td className="px-2 py-1.5 text-xs"></td>
              <td className="px-2 py-1.5 text-xs"></td>
              <td className="px-2 py-1.5 text-xs"></td>
              <td className="px-2 py-1.5 text-xs"></td>
              <td className="px-2 py-1.5 text-xs"></td>
              <td className="px-2 py-1.5 text-xs"></td>
              <td className="px-2 py-1.5">
                {linkedInPlatform ? (
                  <span className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
                    <Check size={10} /> Linked
                  </span>
                ) : (
                  <span className="text-xs text-app-text-subtle">Not linked</span>
                )}
              </td>
              <td className="px-2 py-1.5">
                <div className="flex items-center justify-end gap-1">
                  {!linkedInPlatform && (
                    <button
                      onClick={() => onShowLinkInput('linkedin')}
                      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs ${PROVIDER_INFO.linkedin.bgColor} ${PROVIDER_INFO.linkedin.color} hover:opacity-80`}
                      title="Link LinkedIn profile"
                    >
                      <Link2 size={10} /> Link
                    </button>
                  )}
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Summary footer */}
      {comparison && (
        <div className="px-3 py-1.5 border-t border-app-border text-xs text-app-text-subtle flex items-center justify-between">
          <span>
            {linkedProviders.length} provider{linkedProviders.length !== 1 ? 's' : ''} linked
            {comparison.summary.differingFields > 0 && (
              <span className="text-amber-600 dark:text-amber-400 ml-2">
                ({comparison.summary.differingFields} field{comparison.summary.differingFields !== 1 ? 's' : ''} differ)
              </span>
            )}
          </span>
          <div className="flex items-center gap-2">
            {anyNeedsDiscovery && (
              <div className="flex items-center gap-1">
                {discoveryProviders
                  .filter(p => needsDiscovery(p))
                  .map(provider => (
                    <button
                      key={provider}
                      onClick={() => handleDiscoverAll(provider)}
                      disabled={discoveringAll !== null}
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs ${PROVIDER_INFO[provider]?.bgColor || ''} ${PROVIDER_INFO[provider]?.color || ''} hover:opacity-80 disabled:opacity-50`}
                      title={`Discover all ancestor ${PROVIDER_INFO[provider]?.name || provider} IDs`}
                    >
                      {discoveringAll === provider ? (
                        <Loader2 size={10} className="animate-spin" />
                      ) : (
                        <Search size={10} />
                      )}
                      Discover All
                    </button>
                  ))}
              </div>
            )}
            <span>Updated: {new Date(comparison.generatedAt).toLocaleDateString()}</span>
          </div>
        </div>
      )}
    </div>
  );
}
