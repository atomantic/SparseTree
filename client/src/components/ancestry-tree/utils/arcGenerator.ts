/**
 * Arc Generator for Fan Chart View
 *
 * Generates SVG arc paths for radial pedigree charts.
 * The fan chart displays ancestors in concentric arcs radiating from the root.
 */

import { getLineageColor, getLineageFromAhnentafel } from './lineageColors';

// Fan chart configuration
export interface FanChartConfig {
  centerX: number;
  centerY: number;
  innerRadius: number;      // Radius of the first (innermost) generation ring
  generationWidth: number;  // Width of each generation ring
  startAngle: number;       // Start angle in degrees (0 = right, 90 = bottom)
  endAngle: number;         // End angle in degrees
  gap: number;              // Gap between adjacent arcs in degrees
}

// Default configuration for a semi-circle fan chart
export const DEFAULT_FAN_CONFIG: FanChartConfig = {
  centerX: 400,
  centerY: 400,
  innerRadius: 80,
  generationWidth: 60,
  startAngle: 180,  // Left side
  endAngle: 360,    // Right side (semi-circle facing up)
  gap: 1,
};

// Arc data for rendering
export interface ArcData {
  ahnentafel: number;
  generation: number;
  position: number;       // Position within generation (0-indexed)
  lineage: 'paternal' | 'maternal' | 'self';
  path: string;           // SVG path data
  color: string;          // Fill color
  innerRadius: number;
  outerRadius: number;
  startAngle: number;     // In radians
  endAngle: number;       // In radians
  centroid: { x: number; y: number; angle: number };  // Center point for text
}

/**
 * Generate arc path data for all positions in a fan chart
 */
export function generateFanChartArcs(
  generations: number,
  config: FanChartConfig = DEFAULT_FAN_CONFIG
): ArcData[] {
  const arcs: ArcData[] = [];
  const { centerX, centerY, innerRadius, generationWidth, startAngle, endAngle, gap } = config;

  // Convert angles to radians
  const startRad = (startAngle * Math.PI) / 180;
  const endRad = (endAngle * Math.PI) / 180;
  const totalAngle = endRad - startRad;

  // Generate arcs for each generation (starting from generation 1 - parents)
  for (let gen = 1; gen <= generations; gen++) {
    const positionsInGen = Math.pow(2, gen);
    const innerR = innerRadius + (gen - 1) * generationWidth;
    const outerR = innerRadius + gen * generationWidth;

    // Gap in radians for this generation
    const gapRad = (gap * Math.PI) / 180;
    const availableAngle = totalAngle - gapRad * positionsInGen;
    const arcAngle = availableAngle / positionsInGen;

    for (let pos = 0; pos < positionsInGen; pos++) {
      const ahnentafel = Math.pow(2, gen) + pos;
      const lineage = getLineageFromAhnentafel(ahnentafel);

      // Calculate start and end angles for this arc
      const arcStart = startRad + pos * (arcAngle + gapRad) + gapRad / 2;
      const arcEnd = arcStart + arcAngle;

      // Generate SVG path
      const path = generateArcPath(centerX, centerY, innerR, outerR, arcStart, arcEnd);

      // Calculate centroid for text placement
      const midAngle = (arcStart + arcEnd) / 2;
      const midR = (innerR + outerR) / 2;
      const centroid = {
        x: centerX + midR * Math.cos(midAngle),
        y: centerY + midR * Math.sin(midAngle),
        angle: (midAngle * 180) / Math.PI,
      };

      // Get color based on lineage and generation
      const color = lineage === 'self'
        ? 'var(--color-app-accent)'
        : getLineageColor(lineage, gen);

      arcs.push({
        ahnentafel,
        generation: gen,
        position: pos,
        lineage,
        path,
        color,
        innerRadius: innerR,
        outerRadius: outerR,
        startAngle: arcStart,
        endAngle: arcEnd,
        centroid,
      });
    }
  }

  return arcs;
}

/**
 * Generate SVG path data for a single arc segment
 *
 * The arc is drawn as a "pie slice" shape:
 * - Move to inner arc start
 * - Arc to inner arc end
 * - Line to outer arc end
 * - Arc back to outer arc start
 * - Line back to inner arc start (close path)
 */
export function generateArcPath(
  cx: number,
  cy: number,
  innerRadius: number,
  outerRadius: number,
  startAngle: number,
  endAngle: number
): string {
  // Calculate all four corner points
  const innerStart = polarToCartesian(cx, cy, innerRadius, startAngle);
  const innerEnd = polarToCartesian(cx, cy, innerRadius, endAngle);
  const outerStart = polarToCartesian(cx, cy, outerRadius, startAngle);
  const outerEnd = polarToCartesian(cx, cy, outerRadius, endAngle);

  // Determine if we need the large arc flag (>180 degrees)
  const largeArcFlag = endAngle - startAngle > Math.PI ? 1 : 0;

  // Build the path:
  // M = move to inner start
  // A = arc to inner end (counterclockwise/sweep=0 for inner arc going up)
  // L = line to outer end
  // A = arc to outer start (clockwise/sweep=1 for outer arc going down)
  // Z = close path
  const path = [
    `M ${innerStart.x} ${innerStart.y}`,
    `A ${innerRadius} ${innerRadius} 0 ${largeArcFlag} 1 ${innerEnd.x} ${innerEnd.y}`,
    `L ${outerEnd.x} ${outerEnd.y}`,
    `A ${outerRadius} ${outerRadius} 0 ${largeArcFlag} 0 ${outerStart.x} ${outerStart.y}`,
    'Z',
  ].join(' ');

  return path;
}

/**
 * Convert polar coordinates to Cartesian
 */
export function polarToCartesian(
  cx: number,
  cy: number,
  radius: number,
  angle: number
): { x: number; y: number } {
  return {
    x: cx + radius * Math.cos(angle),
    y: cy + radius * Math.sin(angle),
  };
}

/**
 * Calculate text rotation for arc labels
 * Returns rotation angle in degrees
 */
export function getTextRotation(centroidAngle: number): number {
  // Normalize to 0-360
  let angle = centroidAngle % 360;
  if (angle < 0) angle += 360;

  // Rotate text to be readable (flip if on bottom half)
  if (angle > 90 && angle < 270) {
    return angle - 180;
  }
  return angle;
}

/**
 * Calculate text anchor based on position in the arc
 */
export function getTextAnchor(centroidAngle: number): 'start' | 'middle' | 'end' {
  // Normalize to 0-360
  let angle = centroidAngle % 360;
  if (angle < 0) angle += 360;

  // Use middle anchor for better centering in arcs
  return 'middle';
}

/**
 * Calculate the best font size based on arc dimensions
 */
export function calculateFontSize(
  innerRadius: number,
  outerRadius: number,
  arcAngle: number
): number {
  const arcLength = ((outerRadius + innerRadius) / 2) * arcAngle;
  const arcHeight = outerRadius - innerRadius;

  // Use the smaller dimension to constrain font size
  const constraint = Math.min(arcLength / 10, arcHeight / 2);

  // Clamp between reasonable bounds
  return Math.max(8, Math.min(14, constraint));
}

/**
 * Check if text will fit in an arc
 */
export function textFitsInArc(
  text: string,
  innerRadius: number,
  outerRadius: number,
  arcAngle: number,
  fontSize: number
): boolean {
  const avgRadius = (innerRadius + outerRadius) / 2;
  const arcLength = avgRadius * arcAngle;
  const estimatedTextWidth = text.length * fontSize * 0.6; // Rough estimate
  const arcHeight = outerRadius - innerRadius;

  return estimatedTextWidth < arcLength * 0.8 && fontSize < arcHeight * 0.8;
}

/**
 * Truncate name to fit in arc
 */
export function truncateNameForArc(
  name: string,
  maxLength: number
): string {
  if (name.length <= maxLength) return name;

  // Try to keep first name
  const parts = name.split(' ');
  if (parts[0].length <= maxLength) {
    return parts[0];
  }

  // Truncate with ellipsis
  return name.slice(0, maxLength - 1) + '\u2026';
}

/**
 * Generate a root circle path for the center of the fan chart
 */
export function generateRootCirclePath(
  cx: number,
  cy: number,
  radius: number
): string {
  return `M ${cx - radius} ${cy} A ${radius} ${radius} 0 1 0 ${cx + radius} ${cy} A ${radius} ${radius} 0 1 0 ${cx - radius} ${cy}`;
}
