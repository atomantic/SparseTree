import { useEffect, useState } from 'react';
import { Skull, Sparkles } from 'lucide-react';
import { EditableField } from '../ui/EditableField';
import { deathsApi } from '../../services/deaths-api';
import type { DeathInfo } from '../../services/deaths-api';

interface Props {
  personId: string;
}

export function CauseOfDeathSection({ personId }: Props) {
  const [info, setInfo] = useState<DeathInfo | null>(null);
  const [togglingUnusual, setTogglingUnusual] = useState(false);

  useEffect(() => {
    deathsApi.get(personId).then(setInfo).catch(console.error);
  }, [personId]);

  if (!info) return null;

  const update = (
    updates: Parameters<typeof deathsApi.set>[1]
  ) => deathsApi.set(personId, updates).then(setInfo);

  const toggleUnusual = async () => {
    setTogglingUnusual(true);
    await update({ isUnusualManual: !info.isUnusualManual }).finally(() =>
      setTogglingUnusual(false)
    );
  };

  return (
    <div className="mt-2 pt-2 border-t border-app-border/40 space-y-1.5 text-sm">
      <div className="flex items-start gap-2">
        <Skull size={14} className="text-app-error shrink-0 mt-1" />
        <span className="text-app-text-muted mt-1">Cause:</span>
        <div className="flex-1 min-w-0">
          <EditableField
            value={info.cause}
            isOverridden={info.causeIsLocal}
            onSave={(value) => update({ cause: value || null }).then(() => undefined)}
            placeholder="e.g. drowned, slain in battle"
            emptyText="Add cause of death"
            displayClassName="text-sm"
          />
        </div>
        <button
          onClick={toggleUnusual}
          disabled={togglingUnusual}
          title={
            info.isUnusualManual
              ? 'Remove from unusual deaths'
              : 'Mark as unusual death'
          }
          className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-xs border transition-colors mt-1 ${
            info.isUnusualManual
              ? 'bg-app-accent text-white border-app-accent'
              : info.isUnusualAuto
              ? 'border-app-accent text-app-accent'
              : 'border-app-border text-app-text-muted hover:border-app-accent'
          }`}
        >
          <Sparkles size={11} />
          {info.isUnusualManual ? 'Unusual' : info.isUnusualAuto ? 'Auto' : 'Mark unusual'}
        </button>
      </div>

      <div className="ml-6">
        <EditableField
          value={info.circumstance}
          isOverridden={info.circumstanceIsLocal}
          onSave={(value) => update({ circumstance: value || null }).then(() => undefined)}
          placeholder="Tell the story of how they died — sources, context, anything notable…"
          emptyText="Add the story / circumstances"
          displayClassName="text-xs text-app-text-muted"
          multiline
        />
      </div>

      {info.isUnusualAuto && info.matchedKeywords.length > 0 && (
        <div className="ml-6 text-[10px] text-app-text-subtle">
          Auto-matched: {info.matchedKeywords.slice(0, 3).join(', ')}
        </div>
      )}
    </div>
  );
}
