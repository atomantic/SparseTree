import { Calendar, MapPin } from 'lucide-react';
import { EditableDate } from '../ui/EditableDate';
import { EditableField } from '../ui/EditableField';

export interface VitalEventData {
  date?: string | null;
  place?: string | null;
}

export interface VitalEventOverrides {
  date?: {
    value: string | null;
    originalValue: string | null;
    isOverridden: boolean;
  };
  place?: {
    value: string | null;
    originalValue: string | null;
    isOverridden: boolean;
  };
}

interface VitalEventCardProps {
  type: 'birth' | 'death' | 'burial';
  data: VitalEventData;
  overrides?: VitalEventOverrides;
  onSaveDate?: (value: string) => Promise<void>;
  onSavePlace?: (value: string) => Promise<void>;
  onRevertDate?: () => Promise<void>;
  onRevertPlace?: () => Promise<void>;
  disabled?: boolean;
  compact?: boolean;
}

const eventConfig = {
  birth: {
    label: 'Birth',
    icon: <Calendar size={14} className="text-app-success" />,
    iconCompact: <Calendar size={12} className="text-app-success" />,
    bgClass: 'border-app-success/30',
  },
  death: {
    label: 'Death',
    icon: <Calendar size={14} className="text-app-error" />,
    iconCompact: <Calendar size={12} className="text-app-error" />,
    bgClass: 'border-app-error/30',
  },
  burial: {
    label: 'Burial',
    icon: <MapPin size={14} className="text-app-text-muted" />,
    iconCompact: <MapPin size={12} className="text-app-text-muted" />,
    bgClass: 'border-app-border',
  },
};

export function VitalEventCard({
  type,
  data,
  overrides,
  onSaveDate,
  onSavePlace,
  onRevertDate,
  onRevertPlace,
  disabled = false,
  compact = false,
}: VitalEventCardProps) {
  const config = eventConfig[type];

  // Get effective values (override takes precedence)
  const effectiveDate = overrides?.date?.isOverridden
    ? overrides.date.value
    : data.date;
  const effectivePlace = overrides?.place?.isOverridden
    ? overrides.place.value
    : data.place;

  if (compact) {
    return (
      <div className={`bg-app-card rounded-lg border ${config.bgClass} p-3`}>
        <h3 className="text-xs font-semibold text-app-text-secondary mb-1.5 flex items-center gap-1.5">
          {config.iconCompact}
          {config.label}
        </h3>
        <div className="space-y-1">
          {onSaveDate ? (
            <EditableDate
              value={effectiveDate}
              originalValue={overrides?.date?.originalValue ?? data.date}
              isOverridden={overrides?.date?.isOverridden ?? false}
              onSave={onSaveDate}
              onRevert={onRevertDate}
              emptyText="—"
              disabled={disabled}
              compact
            />
          ) : (
            <p className="text-xs text-app-text">{effectiveDate || '—'}</p>
          )}

          {onSavePlace ? (
            <EditableField
              value={effectivePlace}
              originalValue={overrides?.place?.originalValue ?? data.place}
              isOverridden={overrides?.place?.isOverridden ?? false}
              onSave={onSavePlace}
              onRevert={onRevertPlace}
              placeholder="Place..."
              emptyText="—"
              disabled={disabled}
              displayClassName="text-app-text-muted text-xs truncate"
            />
          ) : effectivePlace ? (
            <p className="text-app-text-muted text-xs truncate" title={effectivePlace}>
              {effectivePlace}
            </p>
          ) : (
            <p className="text-app-text-subtle text-xs">—</p>
          )}
        </div>
      </div>
    );
  }

  // Standard layout
  const hasData = data.date || data.place;

  // Don't render if no data and no overrides
  if (!hasData && !overrides?.date?.isOverridden && !overrides?.place?.isOverridden) {
    return null;
  }

  return (
    <div className={`bg-app-card rounded-lg border ${config.bgClass} p-4`}>
      <h3 className="text-sm font-semibold text-app-text-secondary mb-3 flex items-center gap-2">
        {config.icon}
        {config.label}
      </h3>

      <div className="space-y-2">
        {onSaveDate ? (
          <EditableDate
            value={effectiveDate}
            originalValue={overrides?.date?.originalValue ?? data.date}
            isOverridden={overrides?.date?.isOverridden ?? false}
            onSave={onSaveDate}
            onRevert={onRevertDate}
            emptyText="Date unknown"
            disabled={disabled}
          />
        ) : effectiveDate ? (
          <p className="text-app-text">{effectiveDate}</p>
        ) : null}

        {onSavePlace ? (
          <EditableField
            value={effectivePlace}
            originalValue={overrides?.place?.originalValue ?? data.place}
            isOverridden={overrides?.place?.isOverridden ?? false}
            onSave={onSavePlace}
            onRevert={onRevertPlace}
            placeholder="Enter place..."
            emptyText="Place unknown"
            disabled={disabled}
            displayClassName="text-app-text-muted text-sm"
          />
        ) : effectivePlace ? (
          <p className="text-app-text-muted text-sm flex items-center gap-1">
            <MapPin size={12} />
            {effectivePlace}
          </p>
        ) : null}
      </div>
    </div>
  );
}
