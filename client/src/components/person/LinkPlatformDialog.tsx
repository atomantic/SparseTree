import { useState, useEffect, useRef } from 'react';
import { X, Loader2, Link2 } from 'lucide-react';

type Platform = 'wikipedia' | 'ancestry' | 'wikitree' | 'linkedin';

interface LinkPlatformDialogProps {
  platform: Platform | null;
  onClose: () => void;
  onLink: (platform: Platform, url: string) => Promise<void>;
  loading?: boolean;
}

const PLATFORM_CONFIG: Record<Platform, {
  title: string;
  placeholder: string;
  hint: string;
  color: string;
  bgColor: string;
}> = {
  wikipedia: {
    title: 'Link Wikipedia Article',
    placeholder: 'https://en.wikipedia.org/wiki/Person_Name',
    hint: 'Paste a Wikipedia URL to import photo and description for this person.',
    color: 'text-blue-600 dark:text-blue-400',
    bgColor: 'bg-blue-600/10',
  },
  ancestry: {
    title: 'Link Ancestry Profile',
    placeholder: 'https://www.ancestry.com/family-tree/person/tree/.../person/...',
    hint: 'Paste an Ancestry profile URL to link this person to their Ancestry tree.',
    color: 'text-emerald-600 dark:text-emerald-400',
    bgColor: 'bg-emerald-600/10',
  },
  wikitree: {
    title: 'Link WikiTree Profile',
    placeholder: 'https://www.wikitree.com/wiki/LastName-123',
    hint: 'Paste a WikiTree URL to link this person to their WikiTree profile.',
    color: 'text-purple-600 dark:text-purple-400',
    bgColor: 'bg-purple-600/10',
  },
  linkedin: {
    title: 'Link LinkedIn Profile',
    placeholder: 'https://www.linkedin.com/in/person-name',
    hint: 'Paste a LinkedIn profile URL to import occupation data for this person.',
    color: 'text-[#0A66C2] dark:text-[#5BA3E6]',
    bgColor: 'bg-[#0A66C2]/10',
  },
};

export function LinkPlatformDialog({ platform, onClose, onLink, loading = false }: LinkPlatformDialogProps) {
  const [url, setUrl] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (platform) {
      setUrl('');
      // Focus input when dialog opens
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [platform]);

  if (!platform) return null;

  const config = PLATFORM_CONFIG[platform];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    await onLink(platform, url.trim());
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={handleKeyDown}
    >
      <div className="bg-app-card rounded-lg border border-app-border shadow-xl max-w-md w-full mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-app-border">
          <div className="flex items-center gap-2">
            <Link2 size={16} className={config.color} />
            <h3 className="font-semibold text-app-text">{config.title}</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-app-text-muted hover:text-app-text hover:bg-app-hover rounded transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="p-4">
          <div className="space-y-3">
            <input
              ref={inputRef}
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={config.placeholder}
              className="w-full px-3 py-2 bg-app-bg border border-app-border rounded text-app-text text-sm focus:outline-none focus:ring-2 focus:ring-app-accent"
              disabled={loading}
            />
            <p className="text-xs text-app-text-subtle">{config.hint}</p>
          </div>

          <div className="flex justify-end gap-2 mt-4">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-3 py-1.5 text-sm text-app-text-secondary hover:bg-app-hover rounded transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !url.trim()}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded ${config.bgColor} ${config.color} hover:opacity-80 disabled:opacity-50 transition-colors`}
            >
              {loading ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Linking...
                </>
              ) : (
                <>
                  <Link2 size={14} />
                  Link
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
