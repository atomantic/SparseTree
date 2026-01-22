import { useState, useEffect } from 'react';
import { X, Loader2, Eye, EyeOff, AlertTriangle } from 'lucide-react';
import type { BuiltInProvider, CredentialsStatus } from '@fsf/shared';

interface CredentialsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (credentials: { email?: string; username?: string; password: string }) => Promise<void>;
  provider: BuiltInProvider;
  displayName: string;
  existingCredentials?: CredentialsStatus;
  isLoading?: boolean;
}

export function CredentialsModal({
  isOpen,
  onClose,
  onSave,
  provider,
  displayName,
  existingCredentials,
  isLoading = false,
}: CredentialsModalProps) {
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Determine if this provider uses email or username based on provider type
  const usesEmail = provider === 'familysearch' || provider === 'ancestry' || provider === '23andme';
  const usesUsername = provider === 'wikitree';

  useEffect(() => {
    if (isOpen) {
      setEmail(existingCredentials?.email || '');
      setUsername(existingCredentials?.username || '');
      setPassword('');
      setShowPassword(false);
      setError(null);
    }
  }, [isOpen, existingCredentials]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!password) {
      setError('Password is required');
      return;
    }

    if (usesEmail && !email) {
      setError('Email is required');
      return;
    }

    if (usesUsername && !username) {
      setError('Username is required');
      return;
    }

    setSaving(true);

    const credentials: { email?: string; username?: string; password: string } = { password };
    if (usesEmail) credentials.email = email;
    if (usesUsername) credentials.username = username;

    await onSave(credentials).catch(err => {
      setError(err.message || 'Failed to save credentials');
    });

    setSaving(false);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-md bg-app-card border border-app-border rounded-lg shadow-xl mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-app-border">
          <h2 className="text-lg font-semibold text-app-text">
            {existingCredentials?.hasCredentials ? 'Update' : 'Add'} {displayName} Credentials
          </h2>
          <button
            onClick={onClose}
            className="p-1 text-app-text-muted hover:text-app-text transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit}>
          <div className="px-6 py-4 space-y-4">
            {/* Security Warning */}
            <div className="flex items-start gap-3 p-3 bg-app-warning-subtle border border-app-warning/30 rounded-lg">
              <AlertTriangle size={20} className="text-app-warning shrink-0 mt-0.5" />
              <div className="text-sm text-app-warning">
                <p className="font-medium">Security Notice</p>
                <p className="mt-1 text-app-warning/80">
                  Credentials are encrypted and stored locally on this server. They are used only for auto-login when sessions expire.
                </p>
              </div>
            </div>

            {/* Email field (for most providers) */}
            {usesEmail && (
              <div>
                <label className="block text-sm font-medium text-app-text-secondary mb-2">
                  Email
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder={`Your ${displayName} email`}
                  className="w-full px-3 py-2 bg-app-bg border border-app-border rounded text-app-text placeholder-app-placeholder focus:border-app-accent focus:outline-none"
                  autoFocus
                />
              </div>
            )}

            {/* Username field (for WikiTree) */}
            {usesUsername && (
              <div>
                <label className="block text-sm font-medium text-app-text-secondary mb-2">
                  Username
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  placeholder={`Your ${displayName} username`}
                  className="w-full px-3 py-2 bg-app-bg border border-app-border rounded text-app-text placeholder-app-placeholder focus:border-app-accent focus:outline-none"
                  autoFocus
                />
              </div>
            )}

            {/* Password field */}
            <div>
              <label className="block text-sm font-medium text-app-text-secondary mb-2">
                Password
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder={existingCredentials?.hasCredentials ? '(unchanged if empty)' : 'Your password'}
                  className="w-full px-3 py-2 pr-10 bg-app-bg border border-app-border rounded text-app-text placeholder-app-placeholder focus:border-app-accent focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-app-text-muted hover:text-app-text transition-colors"
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              {existingCredentials?.hasCredentials && (
                <p className="text-xs text-app-text-muted mt-1">
                  Leave blank to keep existing password
                </p>
              )}
            </div>

            {/* Error message */}
            {error && (
              <div className="text-sm text-app-error bg-app-error-subtle border border-app-error/30 rounded p-3">
                {error}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-3 px-6 py-4 border-t border-app-border">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-app-text-secondary hover:text-app-text transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || isLoading}
              className="px-4 py-2 bg-app-accent text-app-text rounded hover:bg-app-accent/80 transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              {(saving || isLoading) ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Saving...
                </>
              ) : (
                'Save Credentials'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
