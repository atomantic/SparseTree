import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Calendar, Cake, Cross } from 'lucide-react';
import type { OnThisDayEvent, DatabaseInfo } from '@fsf/shared';
import { api } from '../../services/api';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function formatOrdinal(day: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = day % 100;
  return day + (s[(v - 20) % 10] || s[v] || s[0]);
}

function yearsAgo(year: number | null): string {
  if (!year) return '';
  const current = new Date().getFullYear();
  const diff = current - year;
  if (diff <= 0) return '';
  return `${diff} years ago`;
}

interface OnThisDayProps {
  databases: DatabaseInfo[];
}

export function OnThisDay({ databases }: OnThisDayProps) {
  const [events, setEvents] = useState<(OnThisDayEvent & { dbId: string })[]>([]);
  const [loading, setLoading] = useState(true);

  const today = new Date();
  const month = today.getMonth() + 1;
  const day = today.getDate();

  useEffect(() => {
    if (databases.length === 0) {
      setLoading(false);
      return;
    }

    Promise.all(
      databases.map(db =>
        api.getOnThisDay(db.id, month, day)
          .then(list => list.map(e => ({ ...e, dbId: db.id })))
          .catch(() => [] as (OnThisDayEvent & { dbId: string })[])
      )
    )
      .then(results => {
        // Flatten and deduplicate by personId+eventType across databases
        const seen = new Set<string>();
        const merged: (OnThisDayEvent & { dbId: string })[] = [];
        for (const list of results) {
          for (const evt of list) {
            const key = `${evt.personId}:${evt.eventType}`;
            if (!seen.has(key)) {
              seen.add(key);
              merged.push(evt);
            }
          }
        }
        // Sort: births first, then by year
        merged.sort((a, b) => {
          if (a.eventType !== b.eventType) return a.eventType === 'birth' ? -1 : 1;
          return (a.year ?? 0) - (b.year ?? 0);
        });
        setEvents(merged);
      })
      .finally(() => setLoading(false));
  }, [databases.length, month, day]);

  if (loading || events.length === 0) return null;

  return (
    <div className="bg-app-card border border-app-border rounded-lg p-4 mb-4">
      <h2 className="text-sm font-semibold text-app-text mb-3 flex items-center gap-2">
        <Calendar size={14} className="text-app-accent" />
        On This Day — {MONTH_NAMES[month - 1]} {formatOrdinal(day)}
      </h2>
      <div className="space-y-2 max-h-64 overflow-y-auto">
        {events.map(evt => (
          <Link
            key={`${evt.personId}-${evt.eventType}`}
            to={`/person/${evt.dbId}/${evt.personId}`}
            className="flex items-center gap-3 p-2 rounded hover:bg-app-accent/10 transition-colors group"
          >
            {/* Photo or icon */}
            {evt.hasPhoto ? (
              <img
                src={api.getPhotoUrl(evt.personId)}
                alt={evt.displayName}
                className="w-8 h-8 rounded-full object-cover border border-app-border flex-shrink-0"
              />
            ) : (
              <div className="w-8 h-8 rounded-full bg-app-border flex items-center justify-center flex-shrink-0">
                {evt.eventType === 'birth' ? (
                  <Cake size={14} className="text-blue-400" />
                ) : (
                  <Cross size={14} className="text-app-text-muted" />
                )}
              </div>
            )}

            {/* Details */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-app-text truncate group-hover:text-app-accent transition-colors">
                  {evt.displayName}
                </span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                  evt.eventType === 'birth'
                    ? 'bg-blue-500/20 text-blue-400'
                    : 'bg-app-text-muted/20 text-app-text-muted'
                }`}>
                  {evt.eventType === 'birth' ? 'Born' : 'Died'}
                </span>
              </div>
              <div className="text-xs text-app-text-muted flex items-center gap-2">
                {evt.year && <span>{evt.year}</span>}
                {evt.year && <span className="text-app-text-subtle">({yearsAgo(evt.year)})</span>}
                {evt.place && <span className="truncate">{evt.place}</span>}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
