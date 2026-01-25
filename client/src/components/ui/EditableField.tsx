import { useState, useRef, useEffect } from 'react';
import { Pencil, Check, X, RotateCcw, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';

interface EditableFieldProps {
  value: string | null | undefined;
  originalValue?: string | null;
  isOverridden?: boolean;
  onSave: (value: string) => Promise<void>;
  onRevert?: () => Promise<void>;
  label?: string;
  placeholder?: string;
  multiline?: boolean;
  className?: string;
  displayClassName?: string;
  inputClassName?: string;
  emptyText?: string;
  disabled?: boolean;
}

export function EditableField({
  value,
  originalValue,
  isOverridden = false,
  onSave,
  onRevert,
  label,
  placeholder = 'Enter value...',
  multiline = false,
  className = '',
  displayClassName = '',
  inputClassName = '',
  emptyText = 'Not specified',
  disabled = false,
}: EditableFieldProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(value ?? '');
  const [isSaving, setIsSaving] = useState(false);
  const [isReverting, setIsReverting] = useState(false);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  useEffect(() => {
    setEditValue(value ?? '');
  }, [value]);

  const handleSave = async () => {
    if (editValue === value) {
      setIsEditing(false);
      return;
    }

    setIsSaving(true);
    await onSave(editValue).catch(err => {
      toast.error(err.message || 'Failed to save');
    });
    setIsSaving(false);
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditValue(value ?? '');
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
    if (e.key === 'Enter' && !multiline) {
      e.preventDefault();
      handleSave();
    } else if (e.key === 'Escape') {
      handleCancel();
    }
  };

  if (isEditing) {
    return (
      <div className={`flex items-start gap-2 ${className}`}>
        {multiline ? (
          <textarea
            ref={inputRef as React.RefObject<HTMLTextAreaElement>}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            className={`flex-1 px-2 py-1 bg-app-bg border border-app-accent rounded text-app-text text-sm focus:outline-none focus:ring-1 focus:ring-app-accent resize-none min-h-[60px] ${inputClassName}`}
            disabled={isSaving}
          />
        ) : (
          <input
            ref={inputRef as React.RefObject<HTMLInputElement>}
            type="text"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            className={`flex-1 px-2 py-1 bg-app-bg border border-app-accent rounded text-app-text text-sm focus:outline-none focus:ring-1 focus:ring-app-accent ${inputClassName}`}
            disabled={isSaving}
          />
        )}
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
    );
  }

  return (
    <div className={`group flex items-start gap-2 ${className}`}>
      <div className={`flex-1 ${displayClassName}`}>
        {label && <span className="text-app-text-muted text-xs block mb-0.5">{label}</span>}
        <div className="flex items-center gap-2">
          <span className={value ? 'text-app-text' : 'text-app-text-subtle italic'}>
            {value || emptyText}
          </span>
          {isOverridden && (
            <span className="px-1.5 py-0.5 text-xs bg-amber-500/20 text-amber-500 rounded" title="This value has been edited">
              edited
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        {!disabled && (
          <button
            onClick={() => setIsEditing(true)}
            className="p-1 text-app-text-muted hover:text-app-accent hover:bg-app-accent/10 rounded transition-colors"
            title="Edit"
          >
            <Pencil size={14} />
          </button>
        )}
        {isOverridden && onRevert && (
          <button
            onClick={handleRevert}
            disabled={isReverting}
            className="p-1 text-app-text-muted hover:text-amber-500 hover:bg-amber-500/10 rounded transition-colors disabled:opacity-50"
            title={`Revert to original: ${originalValue ?? 'empty'}`}
          >
            {isReverting ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
          </button>
        )}
      </div>
    </div>
  );
}
