import { useState } from 'react';
import { Plus, Pencil, X, Check, RotateCcw, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';

export interface ListItem {
  id: string;
  value: string;
  source: string;
  isOverridden?: boolean;
  originalValue?: string;
}

interface EditableListProps {
  items: ListItem[];
  label: string;
  icon?: React.ReactNode;
  onAdd: (value: string) => Promise<void>;
  onUpdate: (id: string, value: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onRevert?: (id: string) => Promise<void>;
  placeholder?: string;
  emptyText?: string;
  className?: string;
  disabled?: boolean;
}

export function EditableList({
  items,
  label,
  icon,
  onAdd,
  onUpdate,
  onDelete,
  onRevert,
  placeholder = 'Enter value...',
  emptyText = 'None',
  className = '',
  disabled = false,
}: EditableListProps) {
  const [isAdding, setIsAdding] = useState(false);
  const [addValue, setAddValue] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [isAddingSaving, setIsAddingSaving] = useState(false);

  const handleAdd = async () => {
    if (!addValue.trim()) return;
    setIsAddingSaving(true);
    await onAdd(addValue.trim()).catch(err => {
      toast.error(err.message || 'Failed to add');
    });
    setIsAddingSaving(false);
    setAddValue('');
    setIsAdding(false);
  };

  const handleUpdate = async (id: string) => {
    if (!editValue.trim()) return;
    setLoadingId(id);
    await onUpdate(id, editValue.trim()).catch(err => {
      toast.error(err.message || 'Failed to update');
    });
    setLoadingId(null);
    setEditingId(null);
    setEditValue('');
  };

  const handleDelete = async (id: string) => {
    setLoadingId(id);
    await onDelete(id).catch(err => {
      toast.error(err.message || 'Failed to delete');
    });
    setLoadingId(null);
  };

  const handleRevert = async (id: string) => {
    if (!onRevert) return;
    setLoadingId(id);
    await onRevert(id).catch(err => {
      toast.error(err.message || 'Failed to revert');
    });
    setLoadingId(null);
  };

  const startEdit = (item: ListItem) => {
    setEditingId(item.id);
    setEditValue(item.value);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditValue('');
  };

  const handleKeyDown = (e: React.KeyboardEvent, action: () => void) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      action();
    } else if (e.key === 'Escape') {
      if (editingId) cancelEdit();
      else {
        setIsAdding(false);
        setAddValue('');
      }
    }
  };

  return (
    <div className={className}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {icon}
          <span className="text-sm font-semibold text-app-text-secondary">{label}</span>
        </div>
        {!disabled && !isAdding && (
          <button
            onClick={() => setIsAdding(true)}
            className="flex items-center gap-1 px-2 py-1 text-xs text-app-accent hover:bg-app-accent/10 rounded transition-colors"
          >
            <Plus size={14} />
            Add
          </button>
        )}
      </div>

      {/* Add form */}
      {isAdding && (
        <div className="flex items-center gap-2 mb-2">
          <input
            type="text"
            value={addValue}
            onChange={(e) => setAddValue(e.target.value)}
            onKeyDown={(e) => handleKeyDown(e, handleAdd)}
            placeholder={placeholder}
            className="flex-1 px-2 py-1.5 bg-app-bg border border-app-accent rounded text-app-text text-sm focus:outline-none focus:ring-1 focus:ring-app-accent"
            disabled={isAddingSaving}
            autoFocus
          />
          <button
            onClick={handleAdd}
            disabled={isAddingSaving || !addValue.trim()}
            className="p-1.5 text-app-success hover:bg-app-success/10 rounded transition-colors disabled:opacity-50"
            title="Save"
          >
            {isAddingSaving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
          </button>
          <button
            onClick={() => {
              setIsAdding(false);
              setAddValue('');
            }}
            disabled={isAddingSaving}
            className="p-1.5 text-app-error hover:bg-app-error/10 rounded transition-colors disabled:opacity-50"
            title="Cancel"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* Items list */}
      {items.length === 0 && !isAdding ? (
        <p className="text-sm text-app-text-subtle italic">{emptyText}</p>
      ) : (
        <div className="space-y-1.5">
          {items.map((item) => (
            <div
              key={item.id}
              className="group flex items-center gap-2 px-3 py-2 bg-app-card rounded border border-app-border"
            >
              {editingId === item.id ? (
                <>
                  <input
                    type="text"
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onKeyDown={(e) => handleKeyDown(e, () => handleUpdate(item.id))}
                    className="flex-1 px-2 py-0.5 bg-app-bg border border-app-accent rounded text-app-text text-sm focus:outline-none focus:ring-1 focus:ring-app-accent"
                    disabled={loadingId === item.id}
                    autoFocus
                  />
                  <button
                    onClick={() => handleUpdate(item.id)}
                    disabled={loadingId === item.id || !editValue.trim()}
                    className="p-1 text-app-success hover:bg-app-success/10 rounded transition-colors disabled:opacity-50"
                    title="Save"
                  >
                    {loadingId === item.id ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                  </button>
                  <button
                    onClick={cancelEdit}
                    disabled={loadingId === item.id}
                    className="p-1 text-app-error hover:bg-app-error/10 rounded transition-colors disabled:opacity-50"
                    title="Cancel"
                  >
                    <X size={14} />
                  </button>
                </>
              ) : (
                <>
                  <span className="flex-1 text-app-text-secondary text-sm">{item.value}</span>
                  {item.isOverridden && (
                    <span className="px-1.5 py-0.5 text-xs bg-amber-500/20 text-amber-500 rounded" title={`Original: ${item.originalValue}`}>
                      edited
                    </span>
                  )}
                  {item.source === 'local' && (
                    <span className="px-1.5 py-0.5 text-xs bg-app-accent/20 text-app-accent rounded">
                      user added
                    </span>
                  )}
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    {!disabled && (
                      <button
                        onClick={() => startEdit(item)}
                        className="p-1 text-app-text-muted hover:text-app-accent hover:bg-app-accent/10 rounded transition-colors"
                        title="Edit"
                      >
                        <Pencil size={14} />
                      </button>
                    )}
                    {item.isOverridden && onRevert && (
                      <button
                        onClick={() => handleRevert(item.id)}
                        disabled={loadingId === item.id}
                        className="p-1 text-app-text-muted hover:text-amber-500 hover:bg-amber-500/10 rounded transition-colors disabled:opacity-50"
                        title={`Revert to: ${item.originalValue}`}
                      >
                        {loadingId === item.id ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
                      </button>
                    )}
                    {!disabled && (
                      <button
                        onClick={() => handleDelete(item.id)}
                        disabled={loadingId === item.id}
                        className="p-1 text-app-text-muted hover:text-app-error hover:bg-app-error/10 rounded transition-colors disabled:opacity-50"
                        title="Delete"
                      >
                        {loadingId === item.id ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />}
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
