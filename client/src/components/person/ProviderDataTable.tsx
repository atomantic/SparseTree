import { useState, useEffect } from 'react';
import { ExternalLink, Download, Upload, Camera, Link2, Loader2, Check, AlertCircle, User } from 'lucide-react';
import toast from 'react-hot-toast';
import type { PersonAugmentation, MultiPlatformComparison, BuiltInProvider, ComparisonStatus } from '@fsf/shared';
import { api } from '../../services/api';

interface ProviderDataTableProps {
  dbId: string;
  personId: string;
  localData: {
    name: string;
    birthDate?: string;
    deathDate?: string;
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
  onShowLinkInput: (platform: 'wikipedia' | 'ancestry' | 'wikitree' | 'linkedin') => void;
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
  loading,
  showUseButton = false,
}: {
  src: string | null;
  alt: string;
  onUsePhoto?: () => void;
  loading?: boolean;
  showUseButton?: boolean;
}) {
  if (!src) {
    return (
      <div className="w-8 h-8 rounded bg-app-bg border border-app-border flex items-center justify-center">
        <User size={14} className="text-app-text-subtle" />
      </div>
    );
  }

  return (
    <div className="relative group">
      <img
        src={src}
        alt={alt}
        className="w-8 h-8 rounded object-cover border border-app-border"
      />
      {showUseButton && onUsePhoto && (
        <button
          onClick={onUsePhoto}
          disabled={loading}
          className="absolute inset-0 flex items-center justify-center bg-black/50 rounded opacity-0 group-hover:opacity-100 transition-opacity"
          title="Use this photo"
        >
          {loading ? (
            <Loader2 size={12} className="animate-spin text-white" />
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
  onShowLinkInput,
  syncLoading,
  scrapeLoading,
  fetchingPhotoFrom,
}: ProviderDataTableProps) {
  const [comparison, setComparison] = useState<MultiPlatformComparison | null>(null);
  const [refreshingProvider, setRefreshingProvider] = useState<string | null>(null);

  // Load comparison data
  useEffect(() => {
    api.getMultiPlatformComparison(dbId, personId)
      .then(setComparison)
      .catch(() => null);
  }, [dbId, personId]);

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

  // Get platform info from augmentation
  const wikiPlatform = augmentation?.platforms?.find(p => p.platform === 'wikipedia');
  const ancestryPlatform = augmentation?.platforms?.find(p => p.platform === 'ancestry');
  const wikiTreePlatform = augmentation?.platforms?.find(p => p.platform === 'wikitree');
  const linkedInPlatform = augmentation?.platforms?.find(p => p.platform === 'linkedin');

  // Build FamilySearch URL
  const fsId = externalId || personId;
  const fsUrl = `https://www.familysearch.org/tree/person/details/${fsId}`;

  // Get field values from comparison data
  const getProviderValue = (provider: string, fieldName: string): { value: string | null; status: ComparisonStatus } => {
    if (!comparison) return { value: null, status: 'missing_provider' };
    const field = comparison.fields.find(f => f.fieldName === fieldName);
    if (!field) return { value: null, status: 'missing_provider' };
    const pv = field.providerValues[provider];
    return pv || { value: null, status: 'missing_provider' };
  };

  // Count differences for a provider
  const getDifferenceCount = (provider: string): number => {
    if (!comparison) return 0;
    return comparison.fields.filter(f => f.providerValues[provider]?.status === 'different').length;
  };

  // Provider photo URLs
  const sparseTreePhotoUrl = hasAncestryPhoto
    ? api.getAncestryPhotoUrl(personId)
    : hasWikiTreePhoto
      ? api.getWikiTreePhotoUrl(personId)
      : hasWikiPhoto
        ? api.getWikiPhotoUrl(personId)
        : hasPhoto
          ? api.getPhotoUrl(personId)
          : null;

  const fsPhotoUrl = hasFsPhoto ? api.getPhotoUrl(personId) : null;
  const ancestryPhotoUrl = hasAncestryPhoto ? api.getAncestryPhotoUrl(personId) : null;
  const wikiTreePhotoUrl = hasWikiTreePhoto ? api.getWikiTreePhotoUrl(personId) : null;
  const wikiPhotoUrl = hasWikiPhoto ? api.getWikiPhotoUrl(personId) : null;
  const linkedInPhotoUrl = hasLinkedInPhoto ? api.getLinkedInPhotoUrl(personId) : null;

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
              <th className="px-2 py-1.5 font-medium text-app-text-muted text-xs">Birth</th>
              <th className="px-2 py-1.5 font-medium text-app-text-muted text-xs">Death</th>
              <th className="px-2 py-1.5 font-medium text-app-text-muted text-xs">Father</th>
              <th className="px-2 py-1.5 font-medium text-app-text-muted text-xs">Mother</th>
              <th className="px-2 py-1.5 font-medium text-app-text-muted text-xs">Children</th>
              <th className="px-2 py-1.5 font-medium text-app-text-muted text-xs">AKA</th>
              <th className="px-2 py-1.5 font-medium text-app-text-muted text-xs">Occupations</th>
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
              <td className="px-2 py-1.5 text-app-text text-xs">{localData.deathDate || 'Living'}</td>
              <td className="px-2 py-1.5 text-app-text text-xs">{localData.fatherName || ''}</td>
              <td className="px-2 py-1.5 text-app-text text-xs">{localData.motherName || ''}</td>
              <td className="px-2 py-1.5 text-app-text text-xs">{localData.childrenCount ?? ''}</td>
              <td className="px-2 py-1.5 text-app-text text-xs max-w-[100px] truncate" title={localData.alternateNames?.join(', ')}>
                {localData.alternateNames?.slice(0, 2).join(', ')}{localData.alternateNames && localData.alternateNames.length > 2 ? '...' : ''}
              </td>
              <td className="px-2 py-1.5 text-app-text text-xs max-w-[80px] truncate" title={localData.occupations?.join(', ')}>
                {localData.occupations?.slice(0, 1).join(', ')}{localData.occupations && localData.occupations.length > 1 ? '...' : ''}
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
                  loading={scrapeLoading}
                  showUseButton={!hasPhoto}
                />
              </td>
              <td className="px-2 py-1.5 text-xs">
                <span className={getProviderValue('familysearch', 'name').status === 'different' ? 'text-amber-600 dark:text-amber-400' : 'text-app-text'}>
                  {getProviderValue('familysearch', 'name').value || localData.name}
                </span>
                {getProviderValue('familysearch', 'name').status === 'different' && (
                  <StatusIcon status="different" />
                )}
              </td>
              <td className="px-2 py-1.5 text-xs">
                <span className={getProviderValue('familysearch', 'birthDate').status === 'different' ? 'text-amber-600 dark:text-amber-400' : 'text-app-text'}>
                  {getProviderValue('familysearch', 'birthDate').value || localData.birthDate || ''}
                </span>
                {getProviderValue('familysearch', 'birthDate').status === 'different' && (
                  <StatusIcon status="different" />
                )}
              </td>
              <td className="px-2 py-1.5 text-xs">
                <span className={getProviderValue('familysearch', 'deathDate').status === 'different' ? 'text-amber-600 dark:text-amber-400' : 'text-app-text'}>
                  {getProviderValue('familysearch', 'deathDate').value || localData.deathDate || 'Living'}
                </span>
                {getProviderValue('familysearch', 'deathDate').status === 'different' && (
                  <StatusIcon status="different" />
                )}
              </td>
              <td className="px-2 py-1.5 text-xs">
                <span className={getProviderValue('familysearch', 'fatherName').status === 'different' ? 'text-amber-600 dark:text-amber-400' : 'text-app-text'}>
                  {getProviderValue('familysearch', 'fatherName').value || ''}
                </span>
                {getProviderValue('familysearch', 'fatherName').status === 'different' && <StatusIcon status="different" />}
              </td>
              <td className="px-2 py-1.5 text-xs">
                <span className={getProviderValue('familysearch', 'motherName').status === 'different' ? 'text-amber-600 dark:text-amber-400' : 'text-app-text'}>
                  {getProviderValue('familysearch', 'motherName').value || ''}
                </span>
                {getProviderValue('familysearch', 'motherName').status === 'different' && <StatusIcon status="different" />}
              </td>
              <td className="px-2 py-1.5 text-xs">
                <span className={getProviderValue('familysearch', 'childrenCount').status === 'different' ? 'text-amber-600 dark:text-amber-400' : 'text-app-text'}>
                  {getProviderValue('familysearch', 'childrenCount').value || ''}
                </span>
                {getProviderValue('familysearch', 'childrenCount').status === 'different' && <StatusIcon status="different" />}
              </td>
              <td className="px-2 py-1.5 text-xs max-w-[100px] truncate" title={getProviderValue('familysearch', 'alternateNames').value || ''}>
                <span className={getProviderValue('familysearch', 'alternateNames').status === 'different' ? 'text-amber-600 dark:text-amber-400' : 'text-app-text'}>
                  {getProviderValue('familysearch', 'alternateNames').value || ''}
                </span>
              </td>
              <td className="px-2 py-1.5 text-xs max-w-[80px] truncate" title={getProviderValue('familysearch', 'occupations').value || ''}>
                <span className={getProviderValue('familysearch', 'occupations').status === 'different' ? 'text-amber-600 dark:text-amber-400' : 'text-app-text'}>
                  {getProviderValue('familysearch', 'occupations').value || ''}
                </span>
              </td>
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
                  loading={fetchingPhotoFrom === 'ancestry'}
                  showUseButton={!!ancestryPlatform && !hasAncestryPhoto}
                />
              </td>
              <td className="px-2 py-1.5 text-xs">
                {ancestryPlatform && (
                  <>
                    <span className={getProviderValue('ancestry', 'name').status === 'different' ? 'text-amber-600 dark:text-amber-400' : 'text-app-text'}>
                      {getProviderValue('ancestry', 'name').value || ''}
                    </span>
                    {getProviderValue('ancestry', 'name').status === 'different' && (
                      <StatusIcon status="different" />
                    )}
                  </>
                )}
              </td>
              <td className="px-2 py-1.5 text-xs">
                {ancestryPlatform && (
                  <>
                    <span className={getProviderValue('ancestry', 'birthDate').status === 'different' ? 'text-amber-600 dark:text-amber-400' : 'text-app-text'}>
                      {getProviderValue('ancestry', 'birthDate').value || ''}
                    </span>
                    {getProviderValue('ancestry', 'birthDate').status === 'different' && (
                      <StatusIcon status="different" />
                    )}
                  </>
                )}
              </td>
              <td className="px-2 py-1.5 text-xs">
                {ancestryPlatform && (
                  <>
                    <span className={getProviderValue('ancestry', 'deathDate').status === 'different' ? 'text-amber-600 dark:text-amber-400' : 'text-app-text'}>
                      {getProviderValue('ancestry', 'deathDate').value || ''}
                    </span>
                    {getProviderValue('ancestry', 'deathDate').status === 'different' && (
                      <StatusIcon status="different" />
                    )}
                  </>
                )}
              </td>
              <td className="px-2 py-1.5 text-xs">
                {ancestryPlatform && (
                  <>
                    <span className={getProviderValue('ancestry', 'fatherName').status === 'different' ? 'text-amber-600 dark:text-amber-400' : 'text-app-text'}>
                      {getProviderValue('ancestry', 'fatherName').value || ''}
                    </span>
                    {getProviderValue('ancestry', 'fatherName').status === 'different' && <StatusIcon status="different" />}
                  </>
                )}
              </td>
              <td className="px-2 py-1.5 text-xs">
                {ancestryPlatform && (
                  <>
                    <span className={getProviderValue('ancestry', 'motherName').status === 'different' ? 'text-amber-600 dark:text-amber-400' : 'text-app-text'}>
                      {getProviderValue('ancestry', 'motherName').value || ''}
                    </span>
                    {getProviderValue('ancestry', 'motherName').status === 'different' && <StatusIcon status="different" />}
                  </>
                )}
              </td>
              <td className="px-2 py-1.5 text-xs">
                {ancestryPlatform && (
                  <>
                    <span className={getProviderValue('ancestry', 'childrenCount').status === 'different' ? 'text-amber-600 dark:text-amber-400' : 'text-app-text'}>
                      {getProviderValue('ancestry', 'childrenCount').value || ''}
                    </span>
                    {getProviderValue('ancestry', 'childrenCount').status === 'different' && <StatusIcon status="different" />}
                  </>
                )}
              </td>
              <td className="px-2 py-1.5 text-xs max-w-[100px] truncate">
                {ancestryPlatform && (
                  <span className={getProviderValue('ancestry', 'alternateNames').status === 'different' ? 'text-amber-600 dark:text-amber-400' : 'text-app-text'}>
                    {getProviderValue('ancestry', 'alternateNames').value || ''}
                  </span>
                )}
              </td>
              <td className="px-2 py-1.5 text-xs max-w-[80px] truncate">
                {ancestryPlatform && (
                  <span className={getProviderValue('ancestry', 'occupations').status === 'different' ? 'text-amber-600 dark:text-amber-400' : 'text-app-text'}>
                    {getProviderValue('ancestry', 'occupations').value || ''}
                  </span>
                )}
              </td>
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
                    <button
                      onClick={() => handleRefreshProvider('ancestry')}
                      disabled={refreshingProvider === 'ancestry'}
                      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs ${PROVIDER_INFO.ancestry.bgColor} ${PROVIDER_INFO.ancestry.color} hover:opacity-80 disabled:opacity-50`}
                      title="Download from Ancestry (includes photo)"
                    >
                      {refreshingProvider === 'ancestry' ? <Loader2 size={10} className="animate-spin" /> : <Download size={10} />}
                    </button>
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
                  loading={fetchingPhotoFrom === 'wikitree'}
                  showUseButton={!!wikiTreePlatform && !hasWikiTreePhoto}
                />
              </td>
              <td className="px-2 py-1.5 text-xs">
                {wikiTreePlatform && (
                  <>
                    <span className={getProviderValue('wikitree', 'name').status === 'different' ? 'text-amber-600 dark:text-amber-400' : 'text-app-text'}>
                      {getProviderValue('wikitree', 'name').value || ''}
                    </span>
                    {getProviderValue('wikitree', 'name').status === 'different' && (
                      <StatusIcon status="different" />
                    )}
                  </>
                )}
              </td>
              <td className="px-2 py-1.5 text-xs">
                {wikiTreePlatform && (
                  <>
                    <span className={getProviderValue('wikitree', 'birthDate').status === 'different' ? 'text-amber-600 dark:text-amber-400' : 'text-app-text'}>
                      {getProviderValue('wikitree', 'birthDate').value || ''}
                    </span>
                    {getProviderValue('wikitree', 'birthDate').status === 'different' && (
                      <StatusIcon status="different" />
                    )}
                  </>
                )}
              </td>
              <td className="px-2 py-1.5 text-xs">
                {wikiTreePlatform && (
                  <>
                    <span className={getProviderValue('wikitree', 'deathDate').status === 'different' ? 'text-amber-600 dark:text-amber-400' : 'text-app-text'}>
                      {getProviderValue('wikitree', 'deathDate').value || ''}
                    </span>
                    {getProviderValue('wikitree', 'deathDate').status === 'different' && (
                      <StatusIcon status="different" />
                    )}
                  </>
                )}
              </td>
              <td className="px-2 py-1.5 text-xs">
                {wikiTreePlatform && (
                  <>
                    <span className={getProviderValue('wikitree', 'fatherName').status === 'different' ? 'text-amber-600 dark:text-amber-400' : 'text-app-text'}>
                      {getProviderValue('wikitree', 'fatherName').value || ''}
                    </span>
                    {getProviderValue('wikitree', 'fatherName').status === 'different' && <StatusIcon status="different" />}
                  </>
                )}
              </td>
              <td className="px-2 py-1.5 text-xs">
                {wikiTreePlatform && (
                  <>
                    <span className={getProviderValue('wikitree', 'motherName').status === 'different' ? 'text-amber-600 dark:text-amber-400' : 'text-app-text'}>
                      {getProviderValue('wikitree', 'motherName').value || ''}
                    </span>
                    {getProviderValue('wikitree', 'motherName').status === 'different' && <StatusIcon status="different" />}
                  </>
                )}
              </td>
              <td className="px-2 py-1.5 text-xs">
                {wikiTreePlatform && (
                  <>
                    <span className={getProviderValue('wikitree', 'childrenCount').status === 'different' ? 'text-amber-600 dark:text-amber-400' : 'text-app-text'}>
                      {getProviderValue('wikitree', 'childrenCount').value || ''}
                    </span>
                    {getProviderValue('wikitree', 'childrenCount').status === 'different' && <StatusIcon status="different" />}
                  </>
                )}
              </td>
              <td className="px-2 py-1.5 text-xs max-w-[100px] truncate">
                {wikiTreePlatform && (
                  <span className={getProviderValue('wikitree', 'alternateNames').status === 'different' ? 'text-amber-600 dark:text-amber-400' : 'text-app-text'}>
                    {getProviderValue('wikitree', 'alternateNames').value || ''}
                  </span>
                )}
              </td>
              <td className="px-2 py-1.5 text-xs max-w-[80px] truncate">
                {wikiTreePlatform && (
                  <span className={getProviderValue('wikitree', 'occupations').status === 'different' ? 'text-amber-600 dark:text-amber-400' : 'text-app-text'}>
                    {getProviderValue('wikitree', 'occupations').value || ''}
                  </span>
                )}
              </td>
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
                    <button
                      onClick={() => handleRefreshProvider('wikitree')}
                      disabled={refreshingProvider === 'wikitree'}
                      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs ${PROVIDER_INFO.wikitree.bgColor} ${PROVIDER_INFO.wikitree.color} hover:opacity-80 disabled:opacity-50`}
                      title="Download from WikiTree (includes photo)"
                    >
                      {refreshingProvider === 'wikitree' ? <Loader2 size={10} className="animate-spin" /> : <Download size={10} />}
                    </button>
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
                />
              </td>
              <td className="px-2 py-1.5 text-xs"></td>
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
                />
              </td>
              <td className="px-2 py-1.5 text-xs"></td>
              <td className="px-2 py-1.5 text-xs"></td>
              <td className="px-2 py-1.5 text-xs"></td>
              <td className="px-2 py-1.5 text-xs"></td>
              <td className="px-2 py-1.5 text-xs"></td>
              <td className="px-2 py-1.5 text-xs"></td>
              <td className="px-2 py-1.5 text-xs"></td>
              <td className="px-2 py-1.5 text-xs max-w-[80px] truncate">
                {linkedInPlatform && augmentation?.descriptions?.find(d => d.source === 'linkedin') && (
                  <span className="text-app-text text-xs">
                    {augmentation.descriptions.find(d => d.source === 'linkedin')?.text || ''}
                  </span>
                )}
              </td>
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
          <span>Updated: {new Date(comparison.generatedAt).toLocaleDateString()}</span>
        </div>
      )}
    </div>
  );
}
