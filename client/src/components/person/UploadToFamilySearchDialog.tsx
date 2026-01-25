import { useState, useEffect } from 'react';
import { X, Upload, Loader2, Check, AlertCircle, ChevronRight, ArrowRight, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import { api, UploadComparisonResult } from '../../services/api';

interface UploadToFamilySearchDialogProps {
  dbId: string;
  personId: string;
  onClose: () => void;
}

export function UploadToFamilySearchDialog({ dbId, personId, onClose }: UploadToFamilySearchDialogProps) {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [comparison, setComparison] = useState<UploadComparisonResult | null>(null);
  const [selectedFields, setSelectedFields] = useState<Set<string>>(new Set());
  const [needsRefresh, setNeedsRefresh] = useState(false);

  useEffect(() => {
    loadComparison();
  }, [dbId, personId]);

  const loadComparison = async () => {
    setLoading(true);
    setError(null);
    setNeedsRefresh(false);

    const result = await api.compareForUpload(dbId, personId).catch(err => {
      // Check if error indicates we need to refresh first
      if (err.message?.includes('Refresh from FamilySearch')) {
        setNeedsRefresh(true);
        setError(null);
      } else {
        setError(err.message);
      }
      return null;
    });

    if (result) {
      setComparison(result);
      // Pre-select all uploadable differences
      const uploadable = result.differences
        .filter(d => d.canUpload)
        .map(d => d.field);
      setSelectedFields(new Set(uploadable));
    }

    setLoading(false);
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    setError(null);

    const result = await api.refreshFromFamilySearch(dbId, personId).catch(err => {
      toast.error(err.message);
      return null;
    });

    if (result) {
      if (result.wasRedirected) {
        toast.success(`Person was merged on FamilySearch. Updated to new ID: ${result.newFsId}`);
      } else {
        toast.success('Refreshed data from FamilySearch');
      }
      // Reload comparison with fresh data
      await loadComparison();
    }

    setRefreshing(false);
  };

  const toggleField = (field: string) => {
    setSelectedFields(prev => {
      const next = new Set(prev);
      if (next.has(field)) {
        next.delete(field);
      } else {
        next.add(field);
      }
      return next;
    });
  };

  const toggleAll = () => {
    if (!comparison) return;
    const uploadable = comparison.differences.filter(d => d.canUpload).map(d => d.field);
    if (selectedFields.size === uploadable.length) {
      setSelectedFields(new Set());
    } else {
      setSelectedFields(new Set(uploadable));
    }
  };

  const handleUpload = async () => {
    if (selectedFields.size === 0) return;

    setUploading(true);

    const result = await api.uploadToFamilySearch(dbId, personId, Array.from(selectedFields)).catch(err => {
      toast.error(err.message);
      return null;
    });

    if (result) {
      if (result.success) {
        toast.success(`Successfully uploaded ${result.uploaded.length} field(s) to FamilySearch`);
        onClose();
      } else if (result.errors.length > 0) {
        const uploadedCount = result.uploaded.length;
        const errorCount = result.errors.length;
        if (uploadedCount > 0) {
          toast.success(`Uploaded ${uploadedCount} field(s), ${errorCount} failed`);
        } else {
          toast.error(`Failed to upload: ${result.errors[0]?.error}`);
        }
      }
    }

    setUploading(false);
  };

  const formatValue = (value: string | string[] | null): string => {
    if (value === null || value === undefined) return '(empty)';
    if (Array.isArray(value)) {
      return value.length > 0 ? value.join(', ') : '(none)';
    }
    return value || '(empty)';
  };

  const uploadableCount = comparison?.differences.filter(d => d.canUpload).length ?? 0;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-app-card rounded-lg border border-app-border shadow-xl max-w-2xl w-full mx-4 max-h-[80vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-app-border">
          <h2 className="text-lg font-semibold text-app-text flex items-center gap-2">
            <Upload size={20} className="text-sky-500" />
            Upload to FamilySearch
          </h2>
          <button
            onClick={onClose}
            className="text-app-text-muted hover:text-app-text transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {/* Refresh button at top */}
          <div className="flex items-center justify-between mb-4 pb-4 border-b border-app-border">
            <span className="text-sm text-app-text-muted">
              Refresh to get latest data from FamilySearch
            </span>
            <button
              onClick={handleRefresh}
              disabled={refreshing || loading}
              className="inline-flex items-center gap-2 px-3 py-1.5 text-sm bg-app-bg border border-app-border rounded hover:bg-app-card hover:border-sky-500/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
              {refreshing ? 'Refreshing...' : 'Refresh from FamilySearch'}
            </button>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 size={32} className="animate-spin text-sky-500" />
              <span className="ml-3 text-app-text-muted">Comparing local data with FamilySearch...</span>
            </div>
          ) : needsRefresh ? (
            <div className="flex flex-col items-center justify-center py-12 gap-4">
              <div className="text-center">
                <RefreshCw size={48} className="mx-auto text-app-text-muted mb-4" />
                <p className="text-app-text mb-2">No cached FamilySearch data available</p>
                <p className="text-sm text-app-text-muted mb-4">
                  Click &quot;Refresh from FamilySearch&quot; above to fetch the latest data.
                </p>
              </div>
            </div>
          ) : error ? (
            <div className="flex items-center gap-3 p-4 bg-app-error/10 rounded-lg text-app-error">
              <AlertCircle size={20} />
              <span>{error}</span>
            </div>
          ) : comparison && comparison.differences.length === 0 ? (
            <div className="flex items-center gap-3 p-4 bg-app-success/10 rounded-lg text-app-success">
              <Check size={20} />
              <span>Local data matches FamilySearch. Nothing to upload.</span>
            </div>
          ) : comparison ? (
            <div className="space-y-4">
              <p className="text-sm text-app-text-muted">
                The following fields differ between your local data and FamilySearch.
                Select the fields you want to upload.
              </p>

              {/* Select All */}
              {uploadableCount > 0 && (
                <div className="flex items-center gap-2 pb-2 border-b border-app-border">
                  <button
                    onClick={toggleAll}
                    className="text-sm text-app-accent hover:underline"
                  >
                    {selectedFields.size === uploadableCount ? 'Deselect All' : 'Select All'}
                  </button>
                  <span className="text-sm text-app-text-muted">
                    ({selectedFields.size} of {uploadableCount} selected)
                  </span>
                </div>
              )}

              {/* Differences List */}
              <div className="space-y-3">
                {comparison.differences.map(diff => (
                  <div
                    key={diff.field}
                    className={`p-3 rounded-lg border ${
                      diff.canUpload
                        ? selectedFields.has(diff.field)
                          ? 'bg-sky-500/10 border-sky-500/30'
                          : 'bg-app-bg border-app-border hover:border-sky-500/30'
                        : 'bg-app-bg border-app-border opacity-60'
                    } ${diff.canUpload ? 'cursor-pointer' : 'cursor-not-allowed'}`}
                    onClick={() => diff.canUpload && toggleField(diff.field)}
                  >
                    <div className="flex items-start gap-3">
                      {/* Checkbox */}
                      <div className={`flex-shrink-0 w-5 h-5 rounded border mt-0.5 flex items-center justify-center ${
                        diff.canUpload
                          ? selectedFields.has(diff.field)
                            ? 'bg-sky-500 border-sky-500'
                            : 'border-app-border'
                          : 'border-app-border bg-app-bg'
                      }`}>
                        {selectedFields.has(diff.field) && <Check size={14} className="text-white" />}
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium text-app-text">{diff.label}</span>
                          {!diff.canUpload && (
                            <span className="text-xs px-1.5 py-0.5 bg-app-warning/20 text-app-warning rounded">
                              Read-only
                            </span>
                          )}
                        </div>

                        {/* Values comparison */}
                        <div className="flex items-center gap-2 text-sm">
                          <div className="flex-1">
                            <span className="text-app-text-subtle">FamilySearch:</span>
                            <span className="ml-1 text-app-text-muted">{formatValue(diff.fsValue)}</span>
                          </div>
                          <ChevronRight size={16} className="text-app-text-subtle flex-shrink-0" />
                          <div className="flex-1">
                            <span className="text-app-text-subtle">Local:</span>
                            <span className="ml-1 text-app-success">{formatValue(diff.localValue)}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-app-border bg-app-bg/50">
          <button
            onClick={onClose}
            className="px-4 py-2 text-app-text-muted hover:text-app-text transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleUpload}
            disabled={uploading || loading || selectedFields.size === 0}
            className="inline-flex items-center gap-2 px-4 py-2 bg-sky-600 text-white rounded hover:bg-sky-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {uploading ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Uploading...
              </>
            ) : (
              <>
                <ArrowRight size={16} />
                Upload {selectedFields.size > 0 ? `(${selectedFields.size})` : ''}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
