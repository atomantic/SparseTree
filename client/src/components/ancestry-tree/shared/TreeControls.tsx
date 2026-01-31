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

/**
 * Compact zoom-only controls for embedding in view footers
 */
export function ZoomControls({
  onZoomIn,
  onZoomOut,
  onResetZoom,
  currentZoom = 1,
  minZoom = 0.15,
  maxZoom = 2,
}: Pick<TreeControlsProps, 'onZoomIn' | 'onZoomOut' | 'onResetZoom' | 'currentZoom' | 'minZoom' | 'maxZoom'>) {
  const zoomPercent = Math.round(currentZoom * 100);

  return (
    <div className="flex items-center gap-1">
      <button
        onClick={onZoomOut}
        disabled={currentZoom <= minZoom}
        className="w-6 h-6 flex items-center justify-center rounded bg-app-border hover:bg-app-hover disabled:opacity-50 text-xs"
        title="Zoom out"
      >
        -
      </button>
      <span className="text-xs text-app-text-muted w-10 text-center">{zoomPercent}%</span>
      <button
        onClick={onZoomIn}
        disabled={currentZoom >= maxZoom}
        className="w-6 h-6 flex items-center justify-center rounded bg-app-border hover:bg-app-hover disabled:opacity-50 text-xs"
        title="Zoom in"
      >
        +
      </button>
      <button
        onClick={onResetZoom}
        className="w-6 h-6 flex items-center justify-center rounded bg-app-border hover:bg-app-hover text-[10px] ml-1"
        title="Fit to view"
      >
        Fit
      </button>
    </div>
  );
}

/**
 * Generation selector for generation-based views
 */
export function GenerationSelector({
  value,
  onChange,
  min = 2,
  max = 8,
  maxLoaded,
  label = 'Generations',
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  maxLoaded?: number;
  label?: string;
}) {
  const effectiveMax = maxLoaded ? Math.min(max, maxLoaded) : max;

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-app-text-muted">{label}:</span>
      <div className="flex items-center gap-1">
        <button
          onClick={() => onChange(Math.max(min, value - 1))}
          disabled={value <= min}
          className="px-2 py-1 text-sm rounded bg-app-border hover:bg-app-hover disabled:opacity-50 disabled:cursor-not-allowed"
        >
          -
        </button>
        <span className="text-sm text-app-text w-8 text-center">{value}</span>
        <button
          onClick={() => onChange(Math.min(effectiveMax, value + 1))}
          disabled={value >= effectiveMax}
          className="px-2 py-1 text-sm rounded bg-app-border hover:bg-app-hover disabled:opacity-50 disabled:cursor-not-allowed"
        >
          +
        </button>
      </div>
      {maxLoaded && (
        <span className="text-xs text-app-text-subtle">of {maxLoaded} loaded</span>
      )}
    </div>
  );
}
