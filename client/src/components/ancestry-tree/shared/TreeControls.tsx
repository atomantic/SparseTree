/**
 * Tree Controls Component
 *
 * Provides zoom controls and generation selector for tree visualizations.
 */
import { ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';

interface TreeControlsProps {
  // Zoom controls
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onResetZoom?: () => void;
  currentZoom?: number;
  minZoom?: number;
  maxZoom?: number;

  // Generation controls
  generations?: number;
  onGenerationsChange?: (generations: number) => void;
  minGenerations?: number;
  maxGenerations?: number;
  maxGenerationsLoaded?: number;

  // Display options
  showZoomControls?: boolean;
  showGenerationControls?: boolean;
  showZoomLabel?: boolean;
  className?: string;
}

export function TreeControls({
  onZoomIn,
  onZoomOut,
  onResetZoom,
  currentZoom = 1,
  minZoom = 0.15,
  maxZoom = 2,
  generations,
  onGenerationsChange,
  minGenerations = 2,
  maxGenerations = 8,
  maxGenerationsLoaded,
  showZoomControls = true,
  showGenerationControls = true,
  showZoomLabel = true,
  className = '',
}: TreeControlsProps) {
  const zoomPercent = Math.round(currentZoom * 100);
  const effectiveMaxGenerations = maxGenerationsLoaded
    ? Math.min(maxGenerations, maxGenerationsLoaded)
    : maxGenerations;

  return (
    <div className={`flex items-center gap-4 ${className}`}>
      {/* Generation controls */}
      {showGenerationControls && generations !== undefined && onGenerationsChange && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-app-text-muted">Generations:</span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => onGenerationsChange(Math.max(minGenerations, generations - 1))}
              disabled={generations <= minGenerations}
              className="w-7 h-7 flex items-center justify-center rounded bg-app-border hover:bg-app-hover disabled:opacity-50 disabled:cursor-not-allowed text-sm"
              title="Show fewer generations"
            >
              -
            </button>
            <span className="text-sm text-app-text w-6 text-center">{generations}</span>
            <button
              onClick={() => onGenerationsChange(Math.min(effectiveMaxGenerations, generations + 1))}
              disabled={generations >= effectiveMaxGenerations}
              className="w-7 h-7 flex items-center justify-center rounded bg-app-border hover:bg-app-hover disabled:opacity-50 disabled:cursor-not-allowed text-sm"
              title="Show more generations"
            >
              +
            </button>
          </div>
          {maxGenerationsLoaded && maxGenerationsLoaded !== maxGenerations && (
            <span className="text-xs text-app-text-subtle">
              of {maxGenerationsLoaded} loaded
            </span>
          )}
        </div>
      )}

      {/* Separator */}
      {showGenerationControls && showZoomControls && generations !== undefined && (
        <div className="h-6 w-px bg-app-border" />
      )}

      {/* Zoom controls */}
      {showZoomControls && (
        <div className="flex items-center gap-1">
          <button
            onClick={onZoomOut}
            disabled={currentZoom <= minZoom}
            className="w-7 h-7 flex items-center justify-center rounded bg-app-border hover:bg-app-hover disabled:opacity-50 disabled:cursor-not-allowed"
            title="Zoom out"
          >
            <ZoomOut className="w-4 h-4" />
          </button>

          {showZoomLabel && (
            <span className="text-xs text-app-text-muted w-12 text-center">
              {zoomPercent}%
            </span>
          )}

          <button
            onClick={onZoomIn}
            disabled={currentZoom >= maxZoom}
            className="w-7 h-7 flex items-center justify-center rounded bg-app-border hover:bg-app-hover disabled:opacity-50 disabled:cursor-not-allowed"
            title="Zoom in"
          >
            <ZoomIn className="w-4 h-4" />
          </button>

          <button
            onClick={onResetZoom}
            className="w-7 h-7 flex items-center justify-center rounded bg-app-border hover:bg-app-hover ml-1"
            title="Reset view"
          >
            <Maximize2 className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}

