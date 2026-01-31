import { useState, useEffect } from 'react';
import { X, Upload, Loader2, Check, AlertCircle, ArrowRight, Camera, User, Calendar, MapPin } from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '../../services/api';
import type { FieldDifference, PhotoComparison } from '../../services/api';

const BASE_URL = '/api';

interface UploadToAncestryDialogProps {
  dbId: string;
  personId: string;
  onClose: () => void;
}

export function UploadToAncestryDialog({ dbId, personId, onClose }: UploadToAncestryDialogProps) {
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [differences, setDifferences] = useState<FieldDifference[]>([]);
  const [photo, setPhoto] = useState<PhotoComparison | null>(null);
  const [selectedFields, setSelectedFields] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadComparison();
  }, [dbId, personId]);

  const loadComparison = async () => {
    setLoading(true);
    setError(null);

    const result = await api.compareForAncestryUpload(dbId, personId).catch(err => {
      setError(err.message);
      return null;
    });

    if (result) {
      setDifferences(result.differences || []);
      setPhoto(result.photo);

      // Pre-select fields that have differences
      const preSelected = new Set<string>();
      for (const diff of result.differences || []) {
        if (diff.canUpload && diff.localValue) {
          preSelected.add(diff.field);
        }
      }
      // Pre-select photo if it differs
      if (result.photo?.localPhotoUrl && result.photo?.photoDiffers) {
        preSelected.add('photo');
      }
      setSelectedFields(preSelected);
    }

    setLoading(false);
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

  const handleUpload = async () => {
    if (selectedFields.size === 0) return;

    setUploading(true);

    const result = await api.uploadToAncestry(dbId, personId, Array.from(selectedFields)).catch(err => {
      toast.error(err.message);
      return null;
    });

    if (result) {
      if (result.success) {
        const uploadedCount = result.uploaded.length;
        toast.success(`Successfully uploaded ${uploadedCount} field${uploadedCount > 1 ? 's' : ''} to Ancestry`);
        onClose();
      } else if (result.errors.length > 0) {
        const errorMessages = result.errors.map(e => `${e.field}: ${e.error}`).join('\n');
        toast.error(`Upload errors:\n${errorMessages}`);
      }
    }

    setUploading(false);
  };

  const getFieldIcon = (field: string) => {
    if (field.includes('Date')) return <Calendar size={14} className="text-blue-500" />;
    if (field.includes('Place')) return <MapPin size={14} className="text-green-500" />;
    return null;
  };

  const hasNoDifferences = differences.length === 0 && (!photo || !photo.photoDiffers);
  const hasSelections = selectedFields.size > 0;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-app-card rounded-lg border border-app-border shadow-xl max-w-lg w-full mx-4 max-h-[80vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-app-border">
          <h2 className="text-lg font-semibold text-app-text flex items-center gap-2">
            <Upload size={20} className="text-emerald-500" />
            Upload to Ancestry
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
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 size={32} className="animate-spin text-emerald-500" />
              <span className="ml-3 text-app-text-muted">Comparing with Ancestry...</span>
            </div>
          ) : error ? (
            <div className="flex items-center gap-3 p-4 bg-app-error/10 rounded-lg text-app-error">
              <AlertCircle size={20} />
              <span>{error}</span>
            </div>
          ) : hasNoDifferences ? (
            <div className="flex items-center gap-3 p-4 bg-app-success/10 rounded-lg text-app-success">
              <Check size={20} />
              <span>All data matches Ancestry. Nothing to upload.</span>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-app-text-muted">
                Select the data you want to upload to Ancestry. Click on a row to toggle selection.
              </p>

              {/* Field Differences */}
              {differences.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-sm font-medium text-app-text-subtle">Vital Information</h3>
                  {differences.map(diff => (
                    <div
                      key={diff.field}
                      className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                        selectedFields.has(diff.field)
                          ? 'bg-emerald-500/10 border-emerald-500/30'
                          : 'bg-app-bg border-app-border hover:border-emerald-500/30'
                      }`}
                      onClick={() => diff.canUpload && toggleField(diff.field)}
                    >
                      <div className="flex items-start gap-3">
                        {/* Checkbox */}
                        <div className={`flex-shrink-0 w-5 h-5 rounded border mt-0.5 flex items-center justify-center ${
                          selectedFields.has(diff.field)
                            ? 'bg-emerald-500 border-emerald-500'
                            : 'border-app-border'
                        }`}>
                          {selectedFields.has(diff.field) && <Check size={14} className="text-white" />}
                        </div>

                        {/* Field Content */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            {getFieldIcon(diff.field)}
                            <span className="font-medium text-app-text">{diff.label}</span>
                          </div>
                          <div className="flex items-center gap-2 text-sm">
                            <span className="text-app-success font-mono truncate">
                              {Array.isArray(diff.localValue) ? diff.localValue.join(', ') : diff.localValue || '(empty)'}
                            </span>
                            <ArrowRight size={12} className="text-app-text-subtle flex-shrink-0" />
                            <span className="text-app-text-muted font-mono truncate">
                              {Array.isArray(diff.fsValue) ? diff.fsValue.join(', ') : diff.fsValue || '(empty)'}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Photo Comparison */}
              {photo?.localPhotoUrl && photo?.photoDiffers && (
                <div className="space-y-2">
                  <h3 className="text-sm font-medium text-app-text-subtle">Photo</h3>
                  <div
                    className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                      selectedFields.has('photo')
                        ? 'bg-emerald-500/10 border-emerald-500/30'
                        : 'bg-app-bg border-app-border hover:border-emerald-500/30'
                    }`}
                    onClick={() => toggleField('photo')}
                  >
                    <div className="flex items-start gap-3">
                      {/* Checkbox */}
                      <div className={`flex-shrink-0 w-5 h-5 rounded border mt-0.5 flex items-center justify-center ${
                        selectedFields.has('photo')
                          ? 'bg-emerald-500 border-emerald-500'
                          : 'border-app-border'
                      }`}>
                        {selectedFields.has('photo') && <Check size={14} className="text-white" />}
                      </div>

                      {/* Photo Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-2">
                          <Camera size={16} className="text-emerald-500" />
                          <span className="font-medium text-app-text">Profile Photo</span>
                          <span className="text-xs px-1.5 py-0.5 bg-amber-500/20 text-amber-600 dark:text-amber-400 rounded">
                            {photo.fsHasPhoto ? 'Different from Ancestry' : 'Not on Ancestry'}
                          </span>
                        </div>

                        {/* Photo Preview */}
                        <div className="flex items-center gap-4">
                          {/* Local Photo */}
                          <div className="text-center">
                            <span className="text-xs text-app-text-subtle block mb-1">Local</span>
                            <img
                              src={`${BASE_URL}${photo.localPhotoUrl}`}
                              alt="Local photo"
                              className="w-16 h-16 rounded object-cover border border-app-success"
                            />
                          </div>

                          <ArrowRight size={16} className="text-app-text-subtle" />

                          {/* Ancestry Photo */}
                          <div className="text-center">
                            <span className="text-xs text-app-text-subtle block mb-1">Ancestry</span>
                            {photo.fsHasPhoto ? (
                              <div className="w-16 h-16 rounded bg-app-bg border border-app-border flex items-center justify-center">
                                <span className="text-xs text-app-text-muted">Has photo</span>
                              </div>
                            ) : (
                              <div className="w-16 h-16 rounded bg-app-bg border border-app-border flex items-center justify-center">
                                <User size={24} className="text-app-text-subtle" />
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
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
            disabled={uploading || loading || !hasSelections}
            className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded hover:bg-emerald-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
