/**
 * Geocode Progress Bar
 *
 * Banner showing count of ungeocoded places with a button to trigger
 * batch geocoding via SSE. Uses EventSource (GET) for reliable streaming.
 */

import { useState, useRef, useCallback, useEffect } from 'react';

interface GeocodeProgressBarProps {
  ungeocoded: string[];
  geocodeStats: { resolved: number; pending: number; notFound: number; error: number; total: number };
  dbId: string;
  onComplete: () => void;
}

interface ProgressState {
  current: number;
  total: number;
  place?: string;
  status?: string;
}

export function GeocodeProgressBar({ ungeocoded, geocodeStats, dbId, onComplete }: GeocodeProgressBarProps) {
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  const startGeocoding = useCallback(() => {
    setIsGeocoding(true);
    setProgress({ current: 0, total: ungeocoded.length });

    const es = new EventSource(`/api/map/geocode/stream?dbId=${encodeURIComponent(dbId)}`);
    eventSourceRef.current = es;

    es.onmessage = (event) => {
      const data = JSON.parse(event.data);

      if (data.type === 'progress') {
        setProgress({ current: data.current, total: data.total, place: data.place, status: data.status });
      }

      if (data.type === 'error') {
        es.close();
        eventSourceRef.current = null;
        setIsGeocoding(false);
        setProgress(null);
        onComplete();
      }

      if (data.type === 'complete') {
        es.close();
        eventSourceRef.current = null;
        setIsGeocoding(false);
        setProgress(null);
        onComplete();
      }
    };

    es.onerror = () => {
      // EventSource will auto-reconnect on transient errors.
      // If the stream has ended (server called res.end()), the readyState
      // will be CLOSED and we should treat it as complete.
      if (es.readyState === EventSource.CLOSED) {
        eventSourceRef.current = null;
        setIsGeocoding(false);
        setProgress(null);
        onComplete();
      }
    };
  }, [ungeocoded, dbId, onComplete]);

  const cancelGeocoding = useCallback(() => {
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    setIsGeocoding(false);
    setProgress(null);
  }, []);

  // Clean up EventSource on unmount
  useEffect(() => () => {
    eventSourceRef.current?.close();
  }, []);

  if (ungeocoded.length === 0 && !isGeocoding) {
    return null;
  }

  const pct = progress && progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;

  return (
    <div className="px-3 py-2 bg-amber-900/30 border-b border-amber-700/50">
      {isGeocoding && progress ? (
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <div className="flex items-center justify-between text-xs text-amber-200 mb-1">
              <span>Geocoding places... {progress.current}/{progress.total}</span>
              <span>{pct}%</span>
            </div>
            <div className="w-full h-1.5 bg-amber-900/50 rounded-full overflow-hidden">
              <div
                className="h-full bg-amber-400 rounded-full transition-all duration-300"
                style={{ width: `${pct}%` }}
              />
            </div>
            {progress.place && (
              <div className="text-xs text-amber-300/70 mt-1 truncate">
                {progress.status === 'resolved' ? '\u{2705}' : progress.status === 'not_found' ? '\u{274C}' : '\u{23F3}'}{' '}
                {progress.place}
              </div>
            )}
          </div>
          <button
            onClick={cancelGeocoding}
            className="px-2 py-1 text-xs bg-amber-800/50 text-amber-200 rounded hover:bg-amber-700/50"
          >
            Cancel
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-between">
          <span className="text-xs text-amber-200">
            {'\u{1F4CD}'} {ungeocoded.length} place{ungeocoded.length !== 1 ? 's' : ''} need geocoding
            {geocodeStats.resolved > 0 && ` (${geocodeStats.resolved} cached)`}
          </span>
          <button
            onClick={startGeocoding}
            className="px-3 py-1 text-xs bg-amber-600 text-white rounded hover:bg-amber-500 font-medium"
          >
            Geocode Places
          </button>
        </div>
      )}
    </div>
  );
}
