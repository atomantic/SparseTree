import { useState, useEffect } from 'react';
import { ExternalLink, Download, Upload, Camera, Link2, Loader2, ChevronDown, ChevronRight, BookOpen, Check, AlertCircle, Minus } from 'lucide-react';
import toast from 'react-hot-toast';
import type { PersonAugmentation, MultiPlatformComparison, BuiltInProvider, ComparisonStatus } from '@fsf/shared';
import { api } from '../../services/api';

interface UnifiedPlatformSectionProps {
  dbId: string;
  personId: string;
  externalId?: string;
  augmentation: PersonAugmentation | null;
  hasPhoto: boolean;
  onSyncFromFamilySearch: () => Promise<void>;
  onScrapePhoto: () => Promise<void>;
  onFetchPhoto: (platform: string) => Promise<void>;
  onShowUploadDialog: () => void;
  onShowLinkInput: (platform: 'wikipedia' | 'ancestry' | 'wikitree') => void;
  syncLoading: boolean;
  scrapeLoading: boolean;
  fetchingPhotoFrom: string | null;
}

// Provider display info
const PROVIDER_INFO: Record<string, { name: string; color: string; bgColor: string; borderColor: string }> = {
  familysearch: { name: 'FamilySearch', color: 'text-sky-600 dark:text-sky-400', bgColor: 'bg-sky-600/10', borderColor: 'border-sky-600/30' },
  ancestry: { name: 'Ancestry', color: 'text-emerald-600 dark:text-emerald-400', bgColor: 'bg-emerald-600/10', borderColor: 'border-emerald-600/30' },
  wikitree: { name: 'WikiTree', color: 'text-purple-600 dark:text-purple-400', bgColor: 'bg-purple-600/10', borderColor: 'border-purple-600/30' },
  wikipedia: { name: 'Wikipedia', color: 'text-blue-600 dark:text-blue-400', bgColor: 'bg-blue-600/10', borderColor: 'border-blue-600/30' },
};

function StatusIcon({ status }: { status: ComparisonStatus }) {
  switch (status) {
    case 'match':
      return <Check size={12} className="text-green-500" />;
    case 'different':
      return <AlertCircle size={12} className="text-amber-500" />;
    default:
      return <Minus size={12} className="text-gray-400" />;
  }
}

export function UnifiedPlatformSection({
  dbId,
  personId,
  externalId,
  augmentation,
  hasPhoto,
  onSyncFromFamilySearch,
  onScrapePhoto,
  onFetchPhoto,
  onShowUploadDialog,
  onShowLinkInput,
  syncLoading,
  scrapeLoading,
  fetchingPhotoFrom,
}: UnifiedPlatformSectionProps) {
  const [comparison, setComparison] = useState<MultiPlatformComparison | null>(null);
  const [showComparison, setShowComparison] = useState(false);
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
    }
    setRefreshingProvider(null);
  };

  // Get platform info
  const wikiPlatform = augmentation?.platforms?.find(p => p.platform === 'wikipedia');
  const ancestryPlatform = augmentation?.platforms?.find(p => p.platform === 'ancestry');
  const wikiTreePlatform = augmentation?.platforms?.find(p => p.platform === 'wikitree');

  // Count linked providers with actual data
  const linkedProviders = comparison?.providers.filter(p => p.isLinked) || [];
  const hasDifferences = (comparison?.summary.differingFields || 0) > 0;

  // Build FamilySearch URL
  const fsId = externalId || personId;
  const fsUrl = `https://www.familysearch.org/tree/person/details/${fsId}`;

  return (
    <div className="bg-app-card rounded-lg border border-app-border">
      {/* Header */}
      <div className="px-4 py-3 border-b border-app-border">
        <h3 className="text-sm font-semibold text-app-text-secondary">Platforms & Data</h3>
      </div>

      {/* Provider Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-app-bg/30 text-left">
              <th className="px-4 py-2 font-medium text-app-text-muted w-32">Provider</th>
              <th className="px-4 py-2 font-medium text-app-text-muted">Status</th>
              <th className="px-4 py-2 font-medium text-app-text-muted text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {/* FamilySearch */}
            <tr className="border-t border-app-border/50 hover:bg-app-hover/30">
              <td className="px-4 py-2">
                <a
                  href={fsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`inline-flex items-center gap-1.5 ${PROVIDER_INFO.familysearch.color} hover:opacity-80`}
                >
                  <ExternalLink size={12} />
                  FamilySearch
                </a>
              </td>
              <td className="px-4 py-2">
                <span className="text-xs text-green-600 dark:text-green-400">Primary source</span>
              </td>
              <td className="px-4 py-2">
                <div className="flex items-center justify-end gap-1.5 flex-wrap">
                  <button
                    onClick={onSyncFromFamilySearch}
                    disabled={syncLoading}
                    className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs ${PROVIDER_INFO.familysearch.bgColor} ${PROVIDER_INFO.familysearch.color} hover:opacity-80 disabled:opacity-50`}
                  >
                    {syncLoading ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                    Download
                  </button>
                  <button
                    onClick={onShowUploadDialog}
                    className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs ${PROVIDER_INFO.familysearch.bgColor} ${PROVIDER_INFO.familysearch.color} hover:opacity-80`}
                  >
                    <Upload size={12} />
                    Upload
                  </button>
                  <button
                    onClick={onScrapePhoto}
                    disabled={scrapeLoading}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs bg-app-hover text-app-text-secondary hover:opacity-80 disabled:opacity-50"
                  >
                    {scrapeLoading ? <Loader2 size={12} className="animate-spin" /> : <Camera size={12} />}
                    {hasPhoto ? 'Rescrape' : 'Scrape'} Photo
                  </button>
                </div>
              </td>
            </tr>

            {/* Ancestry */}
            <tr className="border-t border-app-border/50 hover:bg-app-hover/30">
              <td className="px-4 py-2">
                {ancestryPlatform ? (
                  <a
                    href={ancestryPlatform.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`inline-flex items-center gap-1.5 ${PROVIDER_INFO.ancestry.color} hover:opacity-80`}
                  >
                    <ExternalLink size={12} />
                    Ancestry
                  </a>
                ) : (
                  <span className="text-app-text-muted">Ancestry</span>
                )}
              </td>
              <td className="px-4 py-2">
                {ancestryPlatform ? (
                  <span className="text-xs text-green-600 dark:text-green-400">Linked</span>
                ) : (
                  <span className="text-xs text-app-text-subtle">Not linked</span>
                )}
              </td>
              <td className="px-4 py-2">
                <div className="flex items-center justify-end gap-1.5">
                  {ancestryPlatform ? (
                    <>
                      <button
                        onClick={() => handleRefreshProvider('ancestry')}
                        disabled={refreshingProvider === 'ancestry'}
                        className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs ${PROVIDER_INFO.ancestry.bgColor} ${PROVIDER_INFO.ancestry.color} hover:opacity-80 disabled:opacity-50`}
                      >
                        {refreshingProvider === 'ancestry' ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                        Download
                      </button>
                      <button
                        onClick={() => onFetchPhoto('ancestry')}
                        disabled={fetchingPhotoFrom === 'ancestry'}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs bg-app-hover text-app-text-secondary hover:opacity-80 disabled:opacity-50"
                      >
                        {fetchingPhotoFrom === 'ancestry' ? <Loader2 size={12} className="animate-spin" /> : <Camera size={12} />}
                        Use Photo
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => onShowLinkInput('ancestry')}
                      className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs ${PROVIDER_INFO.ancestry.bgColor} ${PROVIDER_INFO.ancestry.color} hover:opacity-80`}
                    >
                      <Link2 size={12} />
                      Link
                    </button>
                  )}
                </div>
              </td>
            </tr>

            {/* WikiTree */}
            <tr className="border-t border-app-border/50 hover:bg-app-hover/30">
              <td className="px-4 py-2">
                {wikiTreePlatform ? (
                  <a
                    href={wikiTreePlatform.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`inline-flex items-center gap-1.5 ${PROVIDER_INFO.wikitree.color} hover:opacity-80`}
                  >
                    <ExternalLink size={12} />
                    WikiTree
                  </a>
                ) : (
                  <span className="text-app-text-muted">WikiTree</span>
                )}
              </td>
              <td className="px-4 py-2">
                {wikiTreePlatform ? (
                  <span className="text-xs text-green-600 dark:text-green-400">Linked</span>
                ) : (
                  <span className="text-xs text-app-text-subtle">Not linked</span>
                )}
              </td>
              <td className="px-4 py-2">
                <div className="flex items-center justify-end gap-1.5">
                  {wikiTreePlatform ? (
                    <button
                      onClick={() => onFetchPhoto('wikitree')}
                      disabled={fetchingPhotoFrom === 'wikitree'}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs bg-app-hover text-app-text-secondary hover:opacity-80 disabled:opacity-50"
                    >
                      {fetchingPhotoFrom === 'wikitree' ? <Loader2 size={12} className="animate-spin" /> : <Camera size={12} />}
                      Use Photo
                    </button>
                  ) : (
                    <button
                      onClick={() => onShowLinkInput('wikitree')}
                      className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs ${PROVIDER_INFO.wikitree.bgColor} ${PROVIDER_INFO.wikitree.color} hover:opacity-80`}
                    >
                      <Link2 size={12} />
                      Link
                    </button>
                  )}
                </div>
              </td>
            </tr>

            {/* Wikipedia */}
            <tr className="border-t border-app-border/50 hover:bg-app-hover/30">
              <td className="px-4 py-2">
                {wikiPlatform ? (
                  <a
                    href={wikiPlatform.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`inline-flex items-center gap-1.5 ${PROVIDER_INFO.wikipedia.color} hover:opacity-80`}
                  >
                    <BookOpen size={12} />
                    Wikipedia
                  </a>
                ) : (
                  <span className="text-app-text-muted flex items-center gap-1.5">
                    <BookOpen size={12} />
                    Wikipedia
                  </span>
                )}
              </td>
              <td className="px-4 py-2">
                {wikiPlatform ? (
                  <span className="text-xs text-green-600 dark:text-green-400">Linked</span>
                ) : (
                  <span className="text-xs text-app-text-subtle">Not linked</span>
                )}
              </td>
              <td className="px-4 py-2">
                <div className="flex items-center justify-end gap-1.5">
                  {wikiPlatform ? (
                    <button
                      onClick={() => onFetchPhoto('wikipedia')}
                      disabled={fetchingPhotoFrom === 'wikipedia'}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs bg-app-hover text-app-text-secondary hover:opacity-80 disabled:opacity-50"
                    >
                      {fetchingPhotoFrom === 'wikipedia' ? <Loader2 size={12} className="animate-spin" /> : <Camera size={12} />}
                      Use Photo
                    </button>
                  ) : (
                    <button
                      onClick={() => onShowLinkInput('wikipedia')}
                      className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs ${PROVIDER_INFO.wikipedia.bgColor} ${PROVIDER_INFO.wikipedia.color} hover:opacity-80`}
                    >
                      <Link2 size={12} />
                      Link
                    </button>
                  )}
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Collapsible Field Comparison */}
      {linkedProviders.length > 0 && (
        <div className="border-t border-app-border">
          <button
            onClick={() => setShowComparison(!showComparison)}
            className="w-full px-4 py-2 flex items-center justify-between hover:bg-app-hover/30 transition-colors text-sm"
          >
            <div className="flex items-center gap-2">
              {showComparison ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <span className="text-app-text-muted">Field Comparison</span>
              {comparison && (
                <>
                  {hasDifferences ? (
                    <span className="px-1.5 py-0.5 bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 rounded text-xs">
                      {comparison.summary.differingFields} difference{comparison.summary.differingFields !== 1 ? 's' : ''}
                    </span>
                  ) : (
                    <span className="px-1.5 py-0.5 bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 rounded text-xs">
                      All match
                    </span>
                  )}
                </>
              )}
            </div>
            <span className="text-xs text-app-text-subtle">
              {linkedProviders.length} provider{linkedProviders.length !== 1 ? 's' : ''} linked
            </span>
          </button>

          {showComparison && comparison && (
            <div className="border-t border-app-border/50">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-app-bg/30 text-left">
                    <th className="px-4 py-1.5 font-medium text-app-text-muted text-xs">Field</th>
                    <th className="px-4 py-1.5 font-medium text-app-text-muted text-xs">Local (FS)</th>
                    {linkedProviders.map(p => (
                      <th key={p.provider} className={`px-4 py-1.5 font-medium text-xs ${PROVIDER_INFO[p.provider]?.color || 'text-app-text-muted'}`}>
                        {PROVIDER_INFO[p.provider]?.name || p.provider}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {comparison.fields.map(field => (
                    <tr key={field.fieldName} className="border-t border-app-border/30">
                      <td className="px-4 py-1.5 text-app-text-secondary text-xs">{field.label}</td>
                      <td className="px-4 py-1.5 text-app-text text-xs">
                        {field.localValue || <span className="text-app-text-subtle">—</span>}
                      </td>
                      {linkedProviders.map(p => {
                        const pv = field.providerValues[p.provider];
                        return (
                          <td key={p.provider} className="px-4 py-1.5 text-xs">
                            <div className="flex items-center gap-1">
                              <StatusIcon status={pv?.status || 'missing_provider'} />
                              <span className={pv?.status === 'different' ? 'text-amber-600 dark:text-amber-400' : 'text-app-text'}>
                                {pv?.value || <span className="text-app-text-subtle">—</span>}
                              </span>
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="px-4 py-1.5 border-t border-app-border/30 text-xs text-app-text-subtle">
                Last compared: {new Date(comparison.generatedAt).toLocaleString()}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
