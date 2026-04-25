import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Calendar, Cake, Cross, ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react';
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

function toIsoDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function isSameMonthDay(a: Date, b: Date): boolean {
  return a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

interface OnThisDayProps {
  databases: DatabaseInfo[];
}

export function OnThisDay({ databases }: OnThisDayProps) {
  const today = useMemo(() => new Date(), []);
  const [viewDate, setViewDate] = useState<Date>(today);
  const [events, setEvents] = useState<(OnThisDayEvent & { dbId: string })[]>([]);
  const [loading, setLoading] = useState(true);

  const month = viewDate.getMonth() + 1;
  const day = viewDate.getDate();
  const isToday = isSameMonthDay(viewDate, today);

  useEffect(() => {
    if (databases.length === 0) {
      setEvents([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    Promise.all(
      databases.map(db =>
        api.getOnThisDay(db.id, month, day)
          .then(list => list.map(e => ({ ...e, dbId: db.id })))
          .catch(() => [] as (OnThisDayEvent & { dbId: string })[])
      )
    )
      .then(results => {
        if (cancelled) return;
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
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [databases, month, day]);

  // Hide entirely when there are no databases at all
  if (databases.length === 0) return null;

  const shiftDay = (delta: number) => {
    const next = new Date(viewDate);
    next.setDate(next.getDate() + delta);
    setViewDate(next);
  };

  const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (!value) return;
    // Parse as local date to avoid timezone shifts
    const [yyyy, mm, dd] = value.split('-').map(Number);
    if (!yyyy || !mm || !dd) return;
    setViewDate(new Date(yyyy, mm - 1, dd));
  };

  return (
    <div className="bg-app-card border border-app-border rounded-lg p-4 mb-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
        <h2 className="text-sm font-semibold text-app-text flex items-center gap-2">
          <Calendar size={14} className="text-app-accent" />
          <span>
            On This Day — {MONTH_NAMES[month - 1]} {formatOrdinal(day)}
          </span>
          {isToday && (
            <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-app-accent/20 text-app-accent">
              Today
            </span>
          )}
        </h2>
        <div className="flex items-center gap-1">
          <button
            onClick={() => shiftDay(-1)}
            className="p-2 min-h-[40px] min-w-[40px] flex items-center justify-center text-app-text-muted hover:text-app-accent hover:bg-app-accent/10 rounded transition-colors"
            title="Previous day"
            aria-label="Previous day"
          >
            <ChevronLeft size={16} />
          </button>
          <input
            type="date"
            value={toIsoDate(viewDate)}
            onChange={handleDateChange}
            className="px-2 py-1.5 min-h-[40px] text-xs bg-app-border text-app-text rounded border border-app-border focus:border-app-accent focus:outline-none"
            aria-label="Select date"
          />
          <button
            onClick={() => shiftDay(1)}
            className="p-2 min-h-[40px] min-w-[40px] flex items-center justify-center text-app-text-muted hover:text-app-accent hover:bg-app-accent/10 rounded transition-colors"
            title="Next day"
            aria-label="Next day"
          >
            <ChevronRight size={16} />
          </button>
          {!isToday && (
            <button
              onClick={() => setViewDate(new Date())}
              className="p-2 min-h-[40px] min-w-[40px] flex items-center justify-center text-app-text-muted hover:text-app-accent hover:bg-app-accent/10 rounded transition-colors"
              title="Jump to today"
              aria-label="Jump to today"
            >
              <RotateCcw size={14} />
            </button>
          )}
        </div>
      </div>
      {loading ? (
        <div className="text-center py-4 text-xs text-app-text-muted">Loading anniversaries…</div>
      ) : events.length === 0 ? (
        <div className="text-center py-4 text-xs text-app-text-muted">
          No ancestors with birth or death anniversaries on this date.
        </div>
      ) : (
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
      )}
    </div>
  );
}
