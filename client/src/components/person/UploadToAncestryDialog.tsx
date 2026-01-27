import { useState, useEffect } from 'react';
import { X, Upload, Loader2, Check, AlertCircle, ArrowRight, Camera, User } from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '../../services/api';
import type { PhotoComparison } from '../../services/api';

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
  const [photo, setPhoto] = useState<PhotoComparison | null>(null);
  const [uploadPhoto, setUploadPhoto] = useState(false);

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
      setPhoto(result.photo);
      // Pre-select photo upload if photo differs
      if (result.photo.localPhotoUrl && result.photo.photoDiffers) {
        setUploadPhoto(true);
      }
    }

    setLoading(false);
  };

  const handleUpload = async () => {
    if (!uploadPhoto) return;

    setUploading(true);

    const result = await api.uploadToAncestry(dbId, personId, ['photo']).catch(err => {
      toast.error(err.message);
      return null;
    });

    if (result) {
      if (result.success) {
        toast.success('Photo uploaded to Ancestry successfully');
        onClose();
      } else if (result.errors.length > 0) {
        toast.error(`Failed to upload: ${result.errors[0]?.error}`);
      }
    }

    setUploading(false);
  };

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
              <span className="ml-3 text-app-text-muted">Checking photo status...</span>
            </div>
          ) : error ? (
            <div className="flex items-center gap-3 p-4 bg-app-error/10 rounded-lg text-app-error">
              <AlertCircle size={20} />
              <span>{error}</span>
            </div>
          ) : !photo?.localPhotoUrl ? (
            <div className="flex items-center gap-3 p-4 bg-app-bg rounded-lg text-app-text-muted">
              <User size={20} />
              <span>No local photo available to upload.</span>
            </div>
          ) : !photo.photoDiffers ? (
            <div className="flex items-center gap-3 p-4 bg-app-success/10 rounded-lg text-app-success">
              <Check size={20} />
              <span>Photo already matches Ancestry. Nothing to upload.</span>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-app-text-muted">
                Upload your local photo to this person&apos;s Ancestry gallery.
              </p>

              {/* Photo Comparison */}
              <div
                className={`p-3 rounded-lg border ${
                  uploadPhoto
                    ? 'bg-emerald-500/10 border-emerald-500/30'
                    : 'bg-app-bg border-app-border hover:border-emerald-500/30'
                } cursor-pointer`}
                onClick={() => setUploadPhoto(!uploadPhoto)}
              >
                <div className="flex items-start gap-3">
                  {/* Checkbox */}
                  <div className={`flex-shrink-0 w-5 h-5 rounded border mt-0.5 flex items-center justify-center ${
                    uploadPhoto
                      ? 'bg-emerald-500 border-emerald-500'
                      : 'border-app-border'
                  }`}>
                    {uploadPhoto && <Check size={14} className="text-white" />}
                  </div>

                  {/* Photo Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      <Camera size={16} className="text-emerald-500" />
                      <span className="font-medium text-app-text">Profile Photo</span>
                      {photo.photoDiffers && (
                        <span className="text-xs px-1.5 py-0.5 bg-amber-500/20 text-amber-600 dark:text-amber-400 rounded">
                          {photo.fsHasPhoto ? 'Different from Ancestry' : 'Not on Ancestry'}
                        </span>
                      )}
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
            disabled={uploading || loading || !uploadPhoto}
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
                Upload Photo
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
