import { useState, useEffect } from 'react';
import { RefreshCw, Check, AlertCircle, Minus, Loader2, ExternalLink, ChevronDown, ChevronRight, Download } from 'lucide-react';
import toast from 'react-hot-toast';
import type { MultiPlatformComparison, BuiltInProvider, ComparisonStatus } from '@fsf/shared';
import { api } from '../../services/api';

interface PlatformComparisonPanelProps {
  dbId: string;
  personId: string;
}

// Provider display info
const PROVIDER_INFO: Record<BuiltInProvider, { name: string; color: string; bgColor: string }> = {
  familysearch: { name: 'FamilySearch', color: 'text-sky-600 dark:text-sky-400', bgColor: 'bg-sky-600/10' },
  ancestry: { name: 'Ancestry', color: 'text-emerald-600 dark:text-emerald-400', bgColor: 'bg-emerald-600/10' },
  wikitree: { name: 'WikiTree', color: 'text-purple-600 dark:text-purple-400', bgColor: 'bg-purple-600/10' },
  '23andme': { name: '23andMe', color: 'text-pink-600 dark:text-pink-400', bgColor: 'bg-pink-600/10' },
};

// Status icons and colors
function StatusIcon({ status }: { status: ComparisonStatus }) {
  switch (status) {
    case 'match':
      return <Check size={14} className="text-green-500" />;
    case 'different':
      return <AlertCircle size={14} className="text-amber-500" />;
    case 'missing_local':
    case 'missing_provider':
      return <Minus size={14} className="text-gray-400" />;
    default:
      return null;
  }
}

function StatusBadge({ status }: { status: ComparisonStatus }) {
  const badges: Record<ComparisonStatus, { text: string; className: string }> = {
    match: { text: 'Match', className: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
    different: { text: 'Different', className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
    missing_local: { text: 'Missing locally', className: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400' },
    missing_provider: { text: 'Not on provider', className: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400' },
  };

  const badge = badges[status];
  return (
    <span className={`px-1.5 py-0.5 rounded text-xs ${badge.className}`}>
      {badge.text}
    </span>
  );
}

export function PlatformComparisonPanel({ dbId, personId }: PlatformComparisonPanelProps) {
  const [comparison, setComparison] = useState<MultiPlatformComparison | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshingProvider, setRefreshingProvider] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load comparison data
  useEffect(() => {
    setLoading(true);
    setError(null);

    api.getMultiPlatformComparison(dbId, personId)
      .then(setComparison)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [dbId, personId]);

  const handleRefreshProvider = async (provider: BuiltInProvider) => {
    setRefreshingProvider(provider);

    const result = await api.refreshFromProvider(dbId, personId, provider)
      .catch(err => {
        toast.error(`Failed to refresh from ${PROVIDER_INFO[provider].name}: ${err.message}`);
        return null;
      });

    if (result) {
      toast.success(`Refreshed data from ${PROVIDER_INFO[provider].name}`);
      // Reload comparison data
      const newComparison = await api.getMultiPlatformComparison(dbId, personId).catch(() => null);
      if (newComparison) {
        setComparison(newComparison);
      }
    }

    setRefreshingProvider(null);
  };

  if (loading) {
    return (
      <div className="bg-app-card rounded-lg border border-app-border p-4">
        <div className="flex items-center gap-2 text-app-text-muted">
          <Loader2 size={16} className="animate-spin" />
          Loading comparison data...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-app-card rounded-lg border border-app-border p-4">
        <div className="text-app-error text-sm">{error}</div>
      </div>
    );
  }

  if (!comparison) {
    return null;
  }

  // Get linked providers (those with data to compare)
  const linkedProviders = comparison.providers.filter(p => p.isLinked);

  if (linkedProviders.length === 0) {
    return (
      <div className="bg-app-card rounded-lg border border-app-border p-4">
        <h3 className="text-sm font-semibold text-app-text-secondary mb-2">Platform Comparison</h3>
        <p className="text-sm text-app-text-muted">
          No external platforms linked. Link platforms in the Platforms section above to compare data.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-app-card rounded-lg border border-app-border">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-app-hover/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          <h3 className="text-sm font-semibold text-app-text-secondary">Platform Comparison</h3>
          {/* Summary badges */}
          {comparison.summary.differingFields > 0 && (
            <span className="px-2 py-0.5 bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 rounded text-xs">
              {comparison.summary.differingFields} difference{comparison.summary.differingFields !== 1 ? 's' : ''}
            </span>
          )}
          {comparison.summary.matchingFields > 0 && comparison.summary.differingFields === 0 && (
            <span className="px-2 py-0.5 bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 rounded text-xs">
              All fields match
            </span>
          )}
        </div>
        <span className="text-xs text-app-text-subtle">
          {linkedProviders.length} provider{linkedProviders.length !== 1 ? 's' : ''} linked
        </span>
      </button>

      {expanded && (
        <div className="border-t border-app-border">
          {/* Provider download/refresh buttons */}
          <div className="px-4 py-3 border-b border-app-border bg-app-bg/50">
            <div className="flex flex-wrap gap-3">
              {linkedProviders.map(provider => {
                const info = PROVIDER_INFO[provider.provider];
                const isRefreshing = refreshingProvider === provider.provider;
                const hasData = !!provider.lastScrapedAt;

                return (
                  <div key={provider.provider} className={`flex items-center gap-2 px-3 py-1.5 rounded-lg ${info.bgColor}`}>
                    <span className={`text-sm font-medium ${info.color}`}>{info.name}</span>
                    {provider.url && (
                      <a
                        href={provider.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-app-text-muted hover:text-app-accent"
                        title={`Open in ${info.name}`}
                      >
                        <ExternalLink size={14} />
                      </a>
                    )}
                    <button
                      onClick={() => handleRefreshProvider(provider.provider)}
                      disabled={isRefreshing}
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium transition-colors disabled:opacity-50 ${
                        hasData
                          ? 'bg-app-hover hover:bg-app-border text-app-text-secondary'
                          : `${info.bgColor} hover:opacity-80 ${info.color}`
                      }`}
                      title={hasData ? `Refresh data from ${info.name}` : `Download data from ${info.name}`}
                    >
                      {isRefreshing ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : hasData ? (
                        <RefreshCw size={12} />
                      ) : (
                        <Download size={12} />
                      )}
                      {hasData ? 'Refresh' : 'Download'}
                    </button>
                    {provider.lastScrapedAt && (
                      <span className="text-xs text-app-text-subtle">
                        {new Date(provider.lastScrapedAt).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Comparison table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-app-bg/30">
                  <th className="px-4 py-2 text-left text-app-text-muted font-medium">Field</th>
                  <th className="px-4 py-2 text-left text-app-text-muted font-medium">Local (FamilySearch)</th>
                  {linkedProviders.map(p => (
                    <th key={p.provider} className={`px-4 py-2 text-left font-medium ${PROVIDER_INFO[p.provider].color}`}>
                      {PROVIDER_INFO[p.provider].name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {comparison.fields.map(field => (
                  <tr key={field.fieldName} className="border-t border-app-border/50 hover:bg-app-hover/30">
                    <td className="px-4 py-2 text-app-text-secondary font-medium">{field.label}</td>
                    <td className="px-4 py-2 text-app-text">
                      {field.localValue || <span className="text-app-text-subtle italic">—</span>}
                    </td>
                    {linkedProviders.map(provider => {
                      const providerValue = field.providerValues[provider.provider];
                      return (
                        <td key={provider.provider} className="px-4 py-2">
                          <div className="flex items-center gap-2">
                            <StatusIcon status={providerValue.status} />
                            <span className={providerValue.status === 'different' ? 'text-amber-600 dark:text-amber-400' : 'text-app-text'}>
                              {providerValue.value || <span className="text-app-text-subtle italic">—</span>}
                            </span>
                          </div>
                          {providerValue.status === 'different' && (
                            <div className="mt-1">
                              <StatusBadge status={providerValue.status} />
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Footer with last generated time */}
          <div className="px-4 py-2 border-t border-app-border bg-app-bg/30 text-xs text-app-text-subtle">
            Comparison generated: {new Date(comparison.generatedAt).toLocaleString()}
          </div>
        </div>
      )}
    </div>
  );
}
