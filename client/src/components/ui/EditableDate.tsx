import { useState, useRef, useEffect } from 'react';
import { Pencil, Check, X, RotateCcw, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';

interface EditableDateProps {
  value: string | null | undefined;
  originalValue?: string | null;
  isOverridden?: boolean;
  onSave: (value: string) => Promise<void>;
  onRevert?: () => Promise<void>;
  label?: string;
  className?: string;
  emptyText?: string;
  disabled?: boolean;
  compact?: boolean;
}

// Validate genealogy date formats:
// "12 Mar 1847", "abt 1523", "before 1800", "after 1700", "1800-1850", "1800"
function isValidGenealogyDate(date: string): boolean {
  if (!date.trim()) return true; // Empty is valid

  const patterns = [
    /^\d{4}$/,                                    // Year only: 1847
    /^\d{1,2}\s+\w{3}\s+\d{4}$/,                  // Full date: 12 Mar 1847
    /^\w{3}\s+\d{4}$/,                            // Month year: Mar 1847
    /^(abt|about|circa|ca\.?)\s+\d{4}$/i,        // About: abt 1523
    /^(before|bef\.?)\s+\d{4}$/i,                // Before: before 1800
    /^(after|aft\.?)\s+\d{4}$/i,                 // After: after 1700
    /^\d{4}\s*[-/]\s*\d{4}$/,                    // Range: 1800-1850
    /^(bet\.?|between)\s+\d{4}\s+(and|&)\s+\d{4}$/i, // Between: bet 1800 and 1850
  ];

  return patterns.some(p => p.test(date.trim()));
}

export function EditableDate({
  value,
  originalValue,
  isOverridden = false,
  onSave,
  onRevert,
  label,
  className = '',
  emptyText = 'Unknown',
  disabled = false,
  compact = false,
}: EditableDateProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(value ?? '');
  const [isSaving, setIsSaving] = useState(false);
  const [isReverting, setIsReverting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  useEffect(() => {
    setEditValue(value ?? '');
    setError(null);
  }, [value]);

  const handleSave = async () => {
    if (editValue === value) {
      setIsEditing(false);
      return;
    }

    if (!isValidGenealogyDate(editValue)) {
      setError('Invalid date format. Try: "12 Mar 1847", "abt 1523", "before 1800"');
      return;
    }

    setIsSaving(true);
    setError(null);
    await onSave(editValue).catch(err => {
      toast.error(err.message || 'Failed to save');
    });
    setIsSaving(false);
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditValue(value ?? '');
    setError(null);
    setIsEditing(false);
  };

  const handleRevert = async () => {
    if (!onRevert) return;
    setIsReverting(true);
    await onRevert().catch(err => {
      toast.error(err.message || 'Failed to revert');
    });
    setIsReverting(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSave();
    } else if (e.key === 'Escape') {
      handleCancel();
    }
  };

  if (isEditing) {
    return (
      <div className={className}>
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            value={editValue}
            onChange={(e) => {
              setEditValue(e.target.value);
              setError(null);
            }}
            onKeyDown={handleKeyDown}
            placeholder="e.g., 12 Mar 1847, abt 1800"
            className={`flex-1 px-2 py-1 bg-app-bg border rounded text-app-text text-sm focus:outline-none focus:ring-1 ${
              error ? 'border-app-error focus:ring-app-error' : 'border-app-accent focus:ring-app-accent'
            }`}
            disabled={isSaving}
          />
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="p-1 text-app-success hover:bg-app-success/10 rounded transition-colors disabled:opacity-50"
            title="Save"
          >
            {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
          </button>
          <button
            onClick={handleCancel}
            disabled={isSaving}
            className="p-1 text-app-error hover:bg-app-error/10 rounded transition-colors disabled:opacity-50"
            title="Cancel"
          >
            <X size={16} />
          </button>
        </div>
        {error && (
          <p className="text-xs text-app-error mt-1">{error}</p>
        )}
        <p className="text-xs text-app-text-subtle mt-1">
          Formats: "12 Mar 1847", "1847", "abt 1800", "before 1800", "after 1700"
        </p>
      </div>
    );
  }

  return (
    <div className={`group flex items-center gap-1 ${className}`}>
      <div className="flex-1 min-w-0">
        {label && <span className="text-app-text-muted text-xs block mb-0.5">{label}</span>}
        <div className="flex items-center gap-1">
          <span className={`${compact ? 'text-xs' : ''} ${value ? 'text-app-text' : 'text-app-text-subtle italic'} truncate`}>
            {value || emptyText}
          </span>
          {isOverridden && (
            <span className={`${compact ? 'px-1 text-[10px]' : 'px-1.5 py-0.5 text-xs'} bg-amber-500/20 text-amber-500 rounded flex-shrink-0`} title="Edited">
              {compact ? '*' : 'edited'}
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
        {!disabled && (
          <button
            onClick={() => setIsEditing(true)}
            className={`${compact ? 'p-0.5' : 'p-1'} text-app-text-muted hover:text-app-accent hover:bg-app-accent/10 rounded transition-colors`}
            title="Edit"
          >
            <Pencil size={compact ? 10 : 14} />
          </button>
        )}
        {isOverridden && onRevert && (
          <button
            onClick={handleRevert}
            disabled={isReverting}
            className={`${compact ? 'p-0.5' : 'p-1'} text-app-text-muted hover:text-amber-500 hover:bg-amber-500/10 rounded transition-colors disabled:opacity-50`}
            title={`Revert to original: ${originalValue ?? 'empty'}`}
          >
            {isReverting ? <Loader2 size={compact ? 10 : 14} className="animate-spin" /> : <RotateCcw size={compact ? 10 : 14} />}
          </button>
        )}
      </div>
    </div>
  );
}
