/**
 * Tree Canvas Component
 *
 * A D3-powered zoom/pan container for tree visualizations.
 * Provides smooth zooming, panning, and auto-centering functionality.
 */
import { useRef, useEffect, useCallback, useState, type ReactNode } from 'react';
import * as d3 from 'd3';

interface TreeCanvasProps {
  children: ReactNode;
  className?: string;
  minZoom?: number;
  maxZoom?: number;
  initialZoom?: number;
  onZoomChange?: (zoom: number) => void;
  centerOnMount?: boolean;
  contentRef?: React.RefObject<HTMLDivElement>;
}

interface Transform {
  x: number;
  y: number;
  k: number;
}

export function TreeCanvas({
  children,
  className = '',
  minZoom = 0.15,
  maxZoom = 2,
  initialZoom = 1,
  onZoomChange,
  centerOnMount = true,
  contentRef: externalContentRef,
}: TreeCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const internalContentRef = useRef<HTMLDivElement>(null);
  const contentRef = externalContentRef || internalContentRef;
  const zoomRef = useRef<d3.ZoomBehavior<HTMLDivElement, unknown> | null>(null);
  const [transform, setTransform] = useState<Transform>({ x: 0, y: 0, k: initialZoom });

  // Center the content within the container
  const centerContent = useCallback(() => {
    const container = containerRef.current;
    const content = contentRef.current;
    if (!container || !content || !zoomRef.current) return;

    const containerRect = container.getBoundingClientRect();
    const contentRect = content.getBoundingClientRect();

    // Get current transform
    const currentTransform = d3.zoomTransform(container);

    // Calculate content dimensions at scale 1
    const contentWidth = contentRect.width / currentTransform.k;
    const contentHeight = contentRect.height / currentTransform.k;

    // Calculate center offset
    const x = (containerRect.width - contentWidth * initialZoom) / 2;
    const y = (containerRect.height - contentHeight * initialZoom) / 2;

    // Apply centered transform
    const containerSelection = d3.select(container);
    containerSelection
      .transition()
      .duration(300)
      .call(zoomRef.current.transform, d3.zoomIdentity.translate(x, y).scale(initialZoom));
  }, [initialZoom, contentRef]);

  // Setup D3 zoom behavior
  useEffect(() => {
    const container = containerRef.current;
    const content = contentRef.current;
    if (!container || !content) return;

    const containerSelection = d3.select(container);
    const contentSelection = d3.select(content);

    const zoom = d3.zoom<HTMLDivElement, unknown>()
      .scaleExtent([minZoom, maxZoom])
      .on('zoom', (event) => {
        const { x, y, k } = event.transform;
        contentSelection.style(
          'transform',
          `translate(${x}px, ${y}px) scale(${k})`
        );
        contentSelection.style('transform-origin', '0 0');
        setTransform({ x, y, k });
        if (onZoomChange) {
          onZoomChange(k);
        }
      });

    containerSelection.call(zoom);
    zoomRef.current = zoom;

    // Set initial transform
    if (centerOnMount) {
      // Give content time to render before centering
      requestAnimationFrame(() => {
        centerContent();
      });
    } else {
      containerSelection.call(zoom.transform, d3.zoomIdentity.scale(initialZoom));
    }

    return () => {
      containerSelection.on('.zoom', null);
    };
  }, [minZoom, maxZoom, initialZoom, onZoomChange, centerOnMount, centerContent, contentRef]);

  // Expose zoom methods
  const zoomIn = useCallback(() => {
    const container = containerRef.current;
    if (!container || !zoomRef.current) return;

    const containerSelection = d3.select(container);
    containerSelection
      .transition()
      .duration(200)
      .call(zoomRef.current.scaleBy, 1.3);
  }, []);

  const zoomOut = useCallback(() => {
    const container = containerRef.current;
    if (!container || !zoomRef.current) return;

    const containerSelection = d3.select(container);
    containerSelection
      .transition()
      .duration(200)
      .call(zoomRef.current.scaleBy, 0.7);
  }, []);

  const resetZoom = useCallback(() => {
    centerContent();
  }, [centerContent]);

  // Center on a specific element
  const centerOnElement = useCallback((elementId: string) => {
    const container = containerRef.current;
    const content = contentRef.current;
    if (!container || !content || !zoomRef.current) return;

    const element = content.querySelector(`[data-person-id="${elementId}"]`);
    if (!element) return;

    const containerRect = container.getBoundingClientRect();
    const contentRect = content.getBoundingClientRect();
    const elementRect = element.getBoundingClientRect();

    // Calculate element position relative to content
    const elementX = elementRect.left - contentRect.left + elementRect.width / 2;
    const elementY = elementRect.top - contentRect.top + elementRect.height / 2;

    // Calculate new transform to center the element
    const targetX = containerRect.width / 2 - elementX * transform.k;
    const targetY = containerRect.height / 2 - elementY * transform.k;

    const containerSelection = d3.select(container);
    containerSelection
      .transition()
      .duration(500)
      .call(zoomRef.current.transform, d3.zoomIdentity.translate(targetX, targetY).scale(transform.k));
  }, [transform.k, contentRef]);

  return (
    <div
      ref={containerRef}
      className={`overflow-hidden cursor-grab active:cursor-grabbing ${className}`}
      style={{ touchAction: 'none' }}
    >
      <div ref={internalContentRef}>
        {children}
      </div>
      {/* Expose methods via data attributes for parent components */}
      <TreeCanvasContext.Provider value={{ zoomIn, zoomOut, resetZoom, centerOnElement, currentZoom: transform.k }}>
        {null}
      </TreeCanvasContext.Provider>
    </div>
  );
}

// Context for zoom controls
import { createContext, useContext } from 'react';

interface TreeCanvasContextValue {
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
  centerOnElement: (elementId: string) => void;
  currentZoom: number;
}

const TreeCanvasContext = createContext<TreeCanvasContextValue | null>(null);

export function useTreeCanvas(): TreeCanvasContextValue | null {
  return useContext(TreeCanvasContext);
}

// Hook for using TreeCanvas with external controls
export function useTreeCanvasControls() {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef<d3.ZoomBehavior<HTMLDivElement, unknown> | null>(null);
  const [currentZoom, setCurrentZoom] = useState(1);

  const setupZoom = useCallback((
    minZoom: number = 0.15,
    maxZoom: number = 2,
    _initialZoom: number = 1
  ) => {
    const container = containerRef.current;
    const content = contentRef.current;
    if (!container || !content) return;

    const containerSelection = d3.select(container);
    const contentSelection = d3.select(content);

    const zoom = d3.zoom<HTMLDivElement, unknown>()
      .scaleExtent([minZoom, maxZoom])
      .on('zoom', (event) => {
        const { x, y, k } = event.transform;
        contentSelection.style(
          'transform',
          `translate(${x}px, ${y}px) scale(${k})`
        );
        contentSelection.style('transform-origin', '0 0');
        setCurrentZoom(k);
      });

    containerSelection.call(zoom);
    zoomRef.current = zoom;

    return () => {
      containerSelection.on('.zoom', null);
    };
  }, []);

  const zoomIn = useCallback(() => {
    const container = containerRef.current;
    if (!container || !zoomRef.current) return;
    d3.select(container).transition().duration(200).call(zoomRef.current.scaleBy, 1.3);
  }, []);

  const zoomOut = useCallback(() => {
    const container = containerRef.current;
    if (!container || !zoomRef.current) return;
    d3.select(container).transition().duration(200).call(zoomRef.current.scaleBy, 0.7);
  }, []);

  const resetZoom = useCallback(() => {
    const container = containerRef.current;
    const content = contentRef.current;
    if (!container || !content || !zoomRef.current) return;

    const containerRect = container.getBoundingClientRect();
    const contentRect = content.getBoundingClientRect();

    const x = (containerRect.width - contentRect.width) / 2;
    const y = (containerRect.height - contentRect.height) / 2;

    d3.select(container)
      .transition()
      .duration(300)
      .call(zoomRef.current.transform, d3.zoomIdentity.translate(x, y).scale(1));
  }, []);

  const setZoom = useCallback((scale: number, duration: number = 200) => {
    const container = containerRef.current;
    if (!container || !zoomRef.current) return;

    const containerSelection = d3.select(container);
    const currentTransform = d3.zoomTransform(container);

    containerSelection
      .transition()
      .duration(duration)
      .call(zoomRef.current.transform, d3.zoomIdentity.translate(currentTransform.x, currentTransform.y).scale(scale));
  }, []);

  const centerOnElement = useCallback((elementId: string) => {
    const container = containerRef.current;
    const content = contentRef.current;
    if (!container || !content || !zoomRef.current) return;

    const element = content.querySelector(`[data-person-id="${elementId}"]`);
    if (!element) return;

    const containerRect = container.getBoundingClientRect();
    const contentRect = content.getBoundingClientRect();
    const elementRect = element.getBoundingClientRect();
    const currentTransform = d3.zoomTransform(container);

    const elementX = (elementRect.left - contentRect.left) / currentTransform.k + elementRect.width / (2 * currentTransform.k);
    const elementY = (elementRect.top - contentRect.top) / currentTransform.k + elementRect.height / (2 * currentTransform.k);

    const targetX = containerRect.width / 2 - elementX * currentTransform.k;
    const targetY = containerRect.height / 2 - elementY * currentTransform.k;

    d3.select(container)
      .transition()
      .duration(500)
      .call(zoomRef.current.transform, d3.zoomIdentity.translate(targetX, targetY).scale(currentTransform.k));
  }, []);

  return {
    containerRef,
    contentRef,
    setupZoom,
    zoomIn,
    zoomOut,
    resetZoom,
    setZoom,
    centerOnElement,
    currentZoom,
  };
}
