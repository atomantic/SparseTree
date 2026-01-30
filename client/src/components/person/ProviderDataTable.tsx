import { useState, useEffect, useRef } from 'react';
import { ExternalLink, Download, Upload, Camera, Link2, Loader2, Check, AlertCircle, User, ArrowRight, ChevronDown } from 'lucide-react';
import toast from 'react-hot-toast';
import type { PersonAugmentation, MultiPlatformComparison, BuiltInProvider, ComparisonStatus, PlatformType } from '@fsf/shared';
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
  photoCacheBuster?: number;
  onSyncFromFamilySearch: () => Promise<void>;
  onScrapePhoto: () => Promise<void>;
  onFetchPhoto: (platform: string) => Promise<void>;
  onShowUploadDialog: () => void;
  onShowAncestryUploadDialog: () => void;
  onShowLinkInput: (platform: 'wikipedia' | 'ancestry' | 'wikitree' | 'linkedin') => void;
  onPhotoChanged?: () => void;  // Called when primary photo changes to refresh parent state
  onFieldChanged?: () => void;  // Called when a field value is applied to refresh parent state
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

// Field labels for display
const FIELD_LABELS: Record<string, string> = {
  name: 'Name',
  birthDate: 'Birth Date',
  birthPlace: 'Birth Place',
  deathDate: 'Death Date',
  deathPlace: 'Death Place',
  fatherName: 'Father',
  motherName: 'Mother',
};

interface MobileProviderCardsProps {
  localData: ProviderDataTableProps['localData'];
  sparseTreePhotoUrl: string | null;
  fsPhotoUrl: string | null;
  ancestryPhotoUrl: string | null;
  wikiTreePhotoUrl: string | null;
  wikiPhotoUrl: string | null;
  linkedInPhotoUrl: string | null;
  hasPhoto: boolean;
  hasFsPhoto: boolean;
  hasAncestryPhoto: boolean;
  hasWikiTreePhoto: boolean;
  hasWikiPhoto: boolean;
  hasLinkedInPhoto: boolean;
  fsUrl: string;
  ancestryPlatform: { url: string } | undefined;
  wikiTreePlatform: { url: string } | undefined;
  wikiPlatform: { url: string } | undefined;
  linkedInPlatform: { url: string } | undefined;
  refreshingProvider: string | null;
  applyingField: string | null;
  syncLoading: boolean;
  scrapeLoading: boolean;
  fetchingPhotoFrom: string | null;
  onSyncFromFamilySearch: () => Promise<void>;
  onScrapePhoto: () => Promise<void>;
  onFetchPhoto: (platform: string) => Promise<void>;
  onShowUploadDialog: () => void;
  onShowAncestryUploadDialog: () => void;
  onShowLinkInput: (platform: 'wikipedia' | 'ancestry' | 'wikitree' | 'linkedin') => void;
  handleRefreshProvider: (provider: BuiltInProvider) => Promise<void>;
  handleUseValue: (fieldName: string, provider: BuiltInProvider, value: string | null) => Promise<void>;
  handleUsePhoto: (provider: BuiltInProvider) => Promise<void>;
  getProviderValue: (provider: string, fieldName: string) => { value: string | null; status: ComparisonStatus; url?: string };
  getLocalUrl: (fieldName: string) => string | undefined;
  getDifferenceCount: (provider: string) => number;
}

function MobileProviderCards({
  localData,
  sparseTreePhotoUrl,
  fsPhotoUrl,
  ancestryPhotoUrl,
  wikiTreePhotoUrl,
  wikiPhotoUrl,
  linkedInPhotoUrl,
  hasPhoto,
  hasFsPhoto,
  hasAncestryPhoto,
  hasWikiTreePhoto,
  hasWikiPhoto,
  hasLinkedInPhoto,
  fsUrl,
  ancestryPlatform,
  wikiTreePlatform,
  wikiPlatform,
  linkedInPlatform,
  refreshingProvider,
  applyingField,
  syncLoading,
  scrapeLoading,
  fetchingPhotoFrom,
  onSyncFromFamilySearch,
  onScrapePhoto,
  onFetchPhoto,
  onShowUploadDialog,
  onShowAncestryUploadDialog,
  onShowLinkInput,
  handleRefreshProvider,
  handleUseValue,
  handleUsePhoto,
  getProviderValue,
  getLocalUrl,
  getDifferenceCount,
}: MobileProviderCardsProps) {
  const [expandedProviders, setExpandedProviders] = useState<Set<string>>(new Set(['sparsetree']));

  const toggleProvider = (provider: string) => {
    setExpandedProviders(prev => {
      const next = new Set(prev);
      if (next.has(provider)) {
        next.delete(provider);
      } else {
        next.add(provider);
      }
      return next;
    });
  };

  // Render a field row for mobile
  const renderMobileField = (
    fieldName: string,
    localValue: string | undefined,
    provider: string,
    showUseButton = true
  ) => {
    const pv = getProviderValue(provider, fieldName);
    if (!pv.value && !localValue) return null;

    const isDifferent = pv.status === 'different';
    const canUse = showUseButton && (pv.status === 'different' || pv.status === 'missing_local') && pv.value;
    const fieldKey = `${fieldName}-${provider}`;
    const isApplying = applyingField === fieldKey;
    const localUrl = getLocalUrl(fieldName);

    return (
      <div key={fieldName} className="flex items-start justify-between gap-2 py-1.5 border-b border-app-border/30 last:border-0">
        <div className="flex-1 min-w-0">
          <div className="text-[10px] text-app-text-muted uppercase">{FIELD_LABELS[fieldName]}</div>
          <div className="text-xs">
            {provider === 'sparsetree' ? (
              localUrl && localValue ? (
                <a href={localUrl} className="text-app-accent hover:underline">{localValue}</a>
              ) : (
                <span className="text-app-text">{localValue || '—'}</span>
              )
            ) : (
              pv.value ? (
                <span className={isDifferent ? 'text-amber-600 dark:text-amber-400' : 'text-app-text'}>
                  {pv.url ? (
                    <a href={pv.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                      {pv.value}
                    </a>
                  ) : (
                    pv.value
                  )}
                  {isDifferent && <AlertCircle size={10} className="inline ml-1 text-amber-500" />}
                </span>
              ) : (
                <span className="text-app-text-subtle">—</span>
              )
            )}
          </div>
        </div>
        {canUse && (
          <button
            onClick={() => handleUseValue(fieldName, provider as BuiltInProvider, pv.value)}
            disabled={isApplying}
            className="flex-shrink-0 px-2 py-1 rounded text-[10px] bg-app-accent/20 text-app-accent hover:bg-app-accent/30 disabled:opacity-50"
          >
            {isApplying ? <Loader2 size={10} className="animate-spin" /> : 'Use'}
          </button>
        )}
      </div>
    );
  };

  // Provider card component
  const ProviderCard = ({
    provider,
    providerKey,
    photoUrl,
    hasProviderPhoto,
    url,
    isLinked,
    differenceCount,
    isPrimary = false,
    onDownload,
    onUpload,
    onLink,
    onFetchPhotoAction,
    onUsePhotoAction,
    downloading,
    fetchingPhoto,
    showPhotoUseButton,
    showPhotoSetPrimaryButton,
  }: {
    provider: string;
    providerKey: PlatformType | 'sparsetree';
    photoUrl: string | null;
    hasProviderPhoto: boolean;
    url?: string;
    isLinked: boolean;
    differenceCount: number;
    isPrimary?: boolean;
    onDownload?: () => void;
    onUpload?: () => void;
    onLink?: () => void;
    onFetchPhotoAction?: () => void;
    onUsePhotoAction?: () => void;
    downloading?: boolean;
    fetchingPhoto?: boolean;
    showPhotoUseButton?: boolean;
    showPhotoSetPrimaryButton?: boolean;
  }) => {
    const isExpanded = expandedProviders.has(providerKey);
    const providerInfo = PROVIDER_INFO[providerKey];

    return (
      <div className="border-b border-app-border/50 last:border-0">
        {/* Card Header - always visible */}
        <button
          onClick={() => toggleProvider(providerKey)}
          className={`w-full flex items-center gap-2 p-2.5 text-left ${isPrimary ? 'bg-app-accent/5' : 'hover:bg-app-hover/30'}`}
        >
          {/* Photo */}
          <PhotoThumbnail
            src={photoUrl}
            alt={provider}
            isPrimary={isPrimary && hasProviderPhoto}
          />

          {/* Provider name + status */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              {url ? (
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`text-xs font-medium ${providerInfo?.color || 'text-app-text'} hover:opacity-80`}
                  onClick={e => e.stopPropagation()}
                >
                  {provider}
                  <ExternalLink size={10} className="inline ml-0.5" />
                </a>
              ) : (
                <span className={`text-xs font-medium ${isLinked ? (providerInfo?.color || 'text-app-text') : 'text-app-text-muted'}`}>
                  {provider}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1 mt-0.5">
              {isPrimary ? (
                <span className="text-[10px] text-app-accent font-medium">Primary</span>
              ) : isLinked ? (
                differenceCount > 0 ? (
                  <span className="text-[10px] text-amber-600 dark:text-amber-400 flex items-center gap-0.5">
                    <AlertCircle size={8} /> {differenceCount} diff
                  </span>
                ) : (
                  <span className="text-[10px] text-green-600 dark:text-green-400 flex items-center gap-0.5">
                    <Check size={8} /> Linked
                  </span>
                )
              ) : (
                <span className="text-[10px] text-app-text-subtle">Not linked</span>
              )}
            </div>
          </div>

          {/* Action buttons (shown even when collapsed) */}
          <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
            {isLinked && onDownload && (
              <button
                onClick={onDownload}
                disabled={downloading}
                className={`p-1.5 rounded ${providerInfo?.bgColor || 'bg-app-bg'} ${providerInfo?.color || 'text-app-text'} hover:opacity-80 disabled:opacity-50`}
                title="Download"
              >
                {downloading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              </button>
            )}
            {isLinked && onUpload && (
              <button
                onClick={onUpload}
                className={`p-1.5 rounded ${providerInfo?.bgColor || 'bg-app-bg'} ${providerInfo?.color || 'text-app-text'} hover:opacity-80`}
                title="Upload"
              >
                <Upload size={14} />
              </button>
            )}
            {!isLinked && onLink && (
              <button
                onClick={onLink}
                className={`p-1.5 rounded ${providerInfo?.bgColor || 'bg-app-bg'} ${providerInfo?.color || 'text-app-text'} hover:opacity-80`}
                title="Link"
              >
                <Link2 size={14} />
              </button>
            )}
          </div>

          {/* Expand indicator */}
          <ChevronDown
            size={16}
            className={`text-app-text-muted transition-transform ${isExpanded ? 'rotate-180' : ''}`}
          />
        </button>

        {/* Expanded content */}
        {isExpanded && (
          <div className="px-3 pb-2.5 bg-app-bg/30">
            {/* Photo row with use button */}
            {providerKey !== 'sparsetree' && (showPhotoUseButton || showPhotoSetPrimaryButton) && (
              <div className="flex items-center justify-between py-1.5 border-b border-app-border/30">
                <div>
                  <div className="text-[10px] text-app-text-muted uppercase">Photo</div>
                  <div className="text-xs text-app-text">
                    {hasProviderPhoto ? 'Available' : 'Not fetched'}
                  </div>
                </div>
                {showPhotoUseButton && onFetchPhotoAction && (
                  <button
                    onClick={onFetchPhotoAction}
                    disabled={fetchingPhoto}
                    className="px-2 py-1 rounded text-[10px] bg-app-accent/20 text-app-accent hover:bg-app-accent/30 disabled:opacity-50"
                  >
                    {fetchingPhoto ? <Loader2 size={10} className="animate-spin" /> : 'Fetch'}
                  </button>
                )}
                {showPhotoSetPrimaryButton && onUsePhotoAction && (
                  <button
                    onClick={onUsePhotoAction}
                    disabled={applyingField === `photo-${providerKey}`}
                    className="px-2 py-1 rounded text-[10px] bg-app-accent/20 text-app-accent hover:bg-app-accent/30 disabled:opacity-50"
                  >
                    {applyingField === `photo-${providerKey}` ? <Loader2 size={10} className="animate-spin" /> : 'Use as Primary'}
                  </button>
                )}
              </div>
            )}

            {/* Fields */}
            {providerKey === 'sparsetree' ? (
              // SparseTree shows local data
              <>
                {renderMobileField('name', localData.name, 'sparsetree', false)}
                {renderMobileField('birthDate', localData.birthDate, 'sparsetree', false)}
                {renderMobileField('birthPlace', localData.birthPlace, 'sparsetree', false)}
                {renderMobileField('deathDate', localData.deathDate || 'Living', 'sparsetree', false)}
                {renderMobileField('deathPlace', localData.deathPlace, 'sparsetree', false)}
                {renderMobileField('fatherName', localData.fatherName, 'sparsetree', false)}
                {renderMobileField('motherName', localData.motherName, 'sparsetree', false)}
              </>
            ) : isLinked ? (
              // Provider shows their data with "Use" buttons
              <>
                {renderMobileField('name', localData.name, providerKey)}
                {renderMobileField('birthDate', localData.birthDate, providerKey)}
                {renderMobileField('birthPlace', localData.birthPlace, providerKey)}
                {renderMobileField('deathDate', localData.deathDate, providerKey)}
                {renderMobileField('deathPlace', localData.deathPlace, providerKey)}
                {renderMobileField('fatherName', localData.fatherName, providerKey)}
                {renderMobileField('motherName', localData.motherName, providerKey)}
              </>
            ) : (
              <div className="py-2 text-xs text-app-text-subtle text-center">
                Link this provider to see data
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="md:hidden">
      {/* SparseTree - Primary */}
      <ProviderCard
        provider="SparseTree"
        providerKey="sparsetree"
        photoUrl={sparseTreePhotoUrl}
        hasProviderPhoto={hasPhoto}
        isLinked={true}
        differenceCount={0}
        isPrimary
      />

      {/* FamilySearch */}
      <ProviderCard
        provider="FamilySearch"
        providerKey="familysearch"
        photoUrl={fsPhotoUrl}
        hasProviderPhoto={hasFsPhoto}
        url={fsUrl}
        isLinked={true}
        differenceCount={getDifferenceCount('familysearch')}
        onDownload={onSyncFromFamilySearch}
        onUpload={onShowUploadDialog}
        downloading={syncLoading}
        fetchingPhoto={scrapeLoading}
        showPhotoUseButton={!hasFsPhoto}
        showPhotoSetPrimaryButton={hasFsPhoto}
        onFetchPhotoAction={onScrapePhoto}
        onUsePhotoAction={() => handleUsePhoto('familysearch')}
      />

      {/* Ancestry */}
      <ProviderCard
        provider="Ancestry"
        providerKey="ancestry"
        photoUrl={ancestryPhotoUrl}
        hasProviderPhoto={hasAncestryPhoto}
        url={ancestryPlatform?.url}
        isLinked={!!ancestryPlatform}
        differenceCount={getDifferenceCount('ancestry')}
        onDownload={ancestryPlatform ? () => handleRefreshProvider('ancestry') : undefined}
        onUpload={ancestryPlatform ? onShowAncestryUploadDialog : undefined}
        onLink={!ancestryPlatform ? () => onShowLinkInput('ancestry') : undefined}
        downloading={refreshingProvider === 'ancestry'}
        fetchingPhoto={fetchingPhotoFrom === 'ancestry'}
        showPhotoUseButton={!!ancestryPlatform && !hasAncestryPhoto}
        showPhotoSetPrimaryButton={hasAncestryPhoto}
        onFetchPhotoAction={() => onFetchPhoto('ancestry')}
        onUsePhotoAction={() => handleUsePhoto('ancestry')}
      />

      {/* WikiTree */}
      <ProviderCard
        provider="WikiTree"
        providerKey="wikitree"
        photoUrl={wikiTreePhotoUrl}
        hasProviderPhoto={hasWikiTreePhoto}
        url={wikiTreePlatform?.url}
        isLinked={!!wikiTreePlatform}
        differenceCount={getDifferenceCount('wikitree')}
        onDownload={wikiTreePlatform ? () => handleRefreshProvider('wikitree') : undefined}
        onLink={!wikiTreePlatform ? () => onShowLinkInput('wikitree') : undefined}
        downloading={refreshingProvider === 'wikitree'}
        fetchingPhoto={fetchingPhotoFrom === 'wikitree'}
        showPhotoUseButton={!!wikiTreePlatform && !hasWikiTreePhoto}
        showPhotoSetPrimaryButton={hasWikiTreePhoto}
        onFetchPhotoAction={() => onFetchPhoto('wikitree')}
        onUsePhotoAction={() => handleUsePhoto('wikitree')}
      />

      {/* Wikipedia */}
      <ProviderCard
        provider="Wikipedia"
        providerKey="wikipedia"
        photoUrl={wikiPhotoUrl}
        hasProviderPhoto={hasWikiPhoto}
        url={wikiPlatform?.url}
        isLinked={!!wikiPlatform}
        differenceCount={0}
        onLink={!wikiPlatform ? () => onShowLinkInput('wikipedia') : undefined}
        fetchingPhoto={fetchingPhotoFrom === 'wikipedia'}
        showPhotoUseButton={!!wikiPlatform && !hasWikiPhoto}
        onFetchPhotoAction={() => onFetchPhoto('wikipedia')}
      />

      {/* LinkedIn */}
      <ProviderCard
        provider="LinkedIn"
        providerKey="linkedin"
        photoUrl={linkedInPhotoUrl}
        hasProviderPhoto={hasLinkedInPhoto}
        url={linkedInPlatform?.url}
        isLinked={!!linkedInPlatform}
        differenceCount={0}
        onLink={!linkedInPlatform ? () => onShowLinkInput('linkedin') : undefined}
        fetchingPhoto={fetchingPhotoFrom === 'linkedin'}
        showPhotoUseButton={!!linkedInPlatform && !hasLinkedInPhoto}
        onFetchPhotoAction={() => onFetchPhoto('linkedin')}
      />
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
  photoCacheBuster,
  onSyncFromFamilySearch,
  onScrapePhoto,
  onFetchPhoto,
  onShowUploadDialog,
  onShowAncestryUploadDialog,
  onShowLinkInput,
  onPhotoChanged,
  onFieldChanged,
  syncLoading,
  scrapeLoading,
  fetchingPhotoFrom,
}: ProviderDataTableProps) {
  const [comparison, setComparison] = useState<MultiPlatformComparison | null>(null);
  const [refreshingProvider, setRefreshingProvider] = useState<string | null>(null);
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
        // Reload comparison and notify parent
        const newComparison = await api.getMultiPlatformComparison(dbId, personId).catch(() => null);
        if (newComparison) setComparison(newComparison);
        onFieldChanged?.();
      }
    } else {
      // Regular fields use local override system
      const result = await api.useProviderField(dbId, personId, fieldName, provider, value).catch(err => {
        toast.error(`Failed to apply ${fieldName} from ${PROVIDER_INFO[provider]?.name || provider}: ${err.message}`);
        return null;
      });

      if (result) {
        toast.success(`Applied ${fieldName} from ${PROVIDER_INFO[provider]?.name || provider}`);
        // Reload comparison and notify parent
        const newComparison = await api.getMultiPlatformComparison(dbId, personId).catch(() => null);
        if (newComparison) setComparison(newComparison);
        onFieldChanged?.();
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
      <div className="flex flex-col gap-0.5">
        {pv.url ? (
          <a href={pv.url} {...(isExternal ? { target: '_blank', rel: 'noopener noreferrer' } : {})} className={`${colorClass} hover:underline`}>{pv.value}</a>
        ) : (
          <span className={colorClass}>{pv.value}</span>
        )}
        {canUse && (
          <button
            onClick={() => handleUseValue(fieldName, provider as BuiltInProvider, pv.value)}
            disabled={isApplying}
            className="inline-flex items-center gap-1 w-fit px-1.5 py-0.5 rounded text-[10px] font-medium bg-app-accent/20 text-app-accent hover:bg-app-accent/30 disabled:opacity-50"
            title={`Use this value from ${PROVIDER_INFO[provider]?.name || provider}`}
          >
            {isApplying ? <Loader2 size={10} className="animate-spin" /> : 'Use'}
          </button>
        )}
      </div>
    );
  };

  // Count differences for a provider
  const getDifferenceCount = (provider: string): number => {
    if (!comparison) return 0;
    return comparison.fields.filter(f => f.providerValues[provider]?.status === 'different').length;
  };

  // Provider photo URLs with cache buster to force refresh after downloads
  // Use comparison's generatedAt timestamp as the cache buster
  const cacheBuster = photoCacheBuster ?? (comparison?.generatedAt ? new Date(comparison.generatedAt).getTime() : undefined);

  // SparseTree row always shows the primary (user-selected) photo - this is our source of truth
  const sparseTreePhotoUrl = hasPhoto ? api.getPhotoUrl(personId, cacheBuster) : null;

  const fsPhotoUrl = hasFsPhoto ? api.getFsPhotoUrl(personId, cacheBuster) : null;
  const ancestryPhotoUrl = hasAncestryPhoto ? api.getAncestryPhotoUrl(personId, cacheBuster) : null;
  const wikiTreePhotoUrl = hasWikiTreePhoto ? api.getWikiTreePhotoUrl(personId, cacheBuster) : null;
  const wikiPhotoUrl = hasWikiPhoto ? api.getWikiPhotoUrl(personId, cacheBuster) : null;
  const linkedInPhotoUrl = hasLinkedInPhoto ? api.getLinkedInPhotoUrl(personId, cacheBuster) : null;

  // Get linked providers from comparison
  const linkedProviders = comparison?.providers.filter(p => p.isLinked) || [];

  return (
    <div className="bg-app-card rounded-lg border border-app-border">
      {/* Header */}
      <div className="px-4 py-2 border-b border-app-border">
        <h3 className="text-sm font-semibold text-app-text-secondary">Provider Data</h3>
      </div>

      {/* Mobile Card View - shown on small screens */}
      <MobileProviderCards
        localData={localData}
        sparseTreePhotoUrl={sparseTreePhotoUrl}
        fsPhotoUrl={fsPhotoUrl}
        ancestryPhotoUrl={ancestryPhotoUrl}
        wikiTreePhotoUrl={wikiTreePhotoUrl}
        wikiPhotoUrl={wikiPhotoUrl}
        linkedInPhotoUrl={linkedInPhotoUrl}
        hasPhoto={hasPhoto}
        hasFsPhoto={hasFsPhoto}
        hasAncestryPhoto={hasAncestryPhoto}
        hasWikiTreePhoto={hasWikiTreePhoto}
        hasWikiPhoto={hasWikiPhoto}
        hasLinkedInPhoto={hasLinkedInPhoto}
        fsUrl={fsUrl}
        ancestryPlatform={ancestryPlatform}
        wikiTreePlatform={wikiTreePlatform}
        wikiPlatform={wikiPlatform}
        linkedInPlatform={linkedInPlatform}
        refreshingProvider={refreshingProvider}
        applyingField={applyingField}
        syncLoading={syncLoading}
        scrapeLoading={scrapeLoading}
        fetchingPhotoFrom={fetchingPhotoFrom}
        onSyncFromFamilySearch={onSyncFromFamilySearch}
        onScrapePhoto={onScrapePhoto}
        onFetchPhoto={onFetchPhoto}
        onShowUploadDialog={onShowUploadDialog}
        onShowAncestryUploadDialog={onShowAncestryUploadDialog}
        onShowLinkInput={onShowLinkInput}
        handleRefreshProvider={handleRefreshProvider}
        handleUseValue={handleUseValue}
        handleUsePhoto={handleUsePhoto}
        getProviderValue={getProviderValue}
        getLocalUrl={getLocalUrl}
        getDifferenceCount={getDifferenceCount}
      />

      {/* Desktop Table View - hidden on small screens */}
      <div className="overflow-x-auto hidden md:block">
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
              <td className="px-2 py-1.5 text-app-text text-xs">{localData.birthPlace || ''}</td>
              <td className="px-2 py-1.5 text-app-text text-xs">{localData.deathDate || 'Living'}</td>
              <td className="px-2 py-1.5 text-app-text text-xs">{localData.deathPlace || ''}</td>
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
              <td className="px-2 py-1.5 text-xs">{renderProviderValue('familysearch', 'birthPlace')}</td>
              <td className="px-2 py-1.5 text-xs">{renderProviderValue('familysearch', 'deathDate')}</td>
              <td className="px-2 py-1.5 text-xs">{renderProviderValue('familysearch', 'deathPlace')}</td>
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
              <td className="px-2 py-1.5 text-xs">{ancestryPlatform && renderProviderValue('ancestry', 'birthPlace')}</td>
              <td className="px-2 py-1.5 text-xs">{ancestryPlatform && renderProviderValue('ancestry', 'deathDate')}</td>
              <td className="px-2 py-1.5 text-xs">{ancestryPlatform && renderProviderValue('ancestry', 'deathPlace')}</td>
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
              <td className="px-2 py-1.5 text-xs">{wikiTreePlatform && renderProviderValue('wikitree', 'birthPlace')}</td>
              <td className="px-2 py-1.5 text-xs">{wikiTreePlatform && renderProviderValue('wikitree', 'deathDate')}</td>
              <td className="px-2 py-1.5 text-xs">{wikiTreePlatform && renderProviderValue('wikitree', 'deathPlace')}</td>
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
            <span>Updated: {new Date(comparison.generatedAt).toLocaleDateString()}</span>
          </div>
        </div>
      )}
    </div>
  );
}
