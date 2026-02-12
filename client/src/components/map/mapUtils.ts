/**
 * Map Utilities
 *
 * Marker icon generators and migration line builders for the
 * Leaflet-based migration map visualization.
 */

import L from 'leaflet';
import type { MapPerson, MapCoords } from '@fsf/shared';
import { PATERNAL_COLORS, MATERNAL_COLORS } from '../ancestry-tree/utils/lineageColors';

// Self color (for root person)
const SELF_COLOR = '#A37FDB'; // Purple

/**
 * Get the lineage color for a person
 */
export function getPersonColor(person: MapPerson): string {
  if (person.lineage === 'self') return SELF_COLOR;
  const colors = person.lineage === 'paternal' ? PATERNAL_COLORS : MATERNAL_COLORS;
  const index = Math.min(person.generation - 1, colors.length - 1);
  return colors[Math.max(0, index)];
}

/**
 * Create a custom Leaflet divIcon marker for a person
 */
export function createPersonMarker(person: MapPerson): L.DivIcon {
  const color = getPersonColor(person);
  const size = person.generation === 0 ? 16 : Math.max(8, 14 - person.generation);
  const borderWidth = person.isFavorite ? 3 : 2;
  const starHtml = person.isFavorite ? '<span style="position:absolute;top:-8px;left:50%;transform:translateX(-50%);font-size:10px;">&#11088;</span>' : '';

  return L.divIcon({
    className: 'map-person-marker',
    html: `<div style="position:relative;">
      ${starHtml}
      <div style="
        width: ${size}px;
        height: ${size}px;
        border-radius: 50%;
        background: ${color};
        border: ${borderWidth}px solid ${person.generation === 0 ? '#fff' : 'rgba(255,255,255,0.7)'};
        box-shadow: 0 1px 4px rgba(0,0,0,0.4);
        cursor: pointer;
      "></div>
    </div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2 - 4],
  });
}

/**
 * Migration line style based on lineage
 */
export function getMigrationLineStyle(lineage: 'paternal' | 'maternal' | 'self'): L.PolylineOptions {
  const color = lineage === 'paternal' ? PATERNAL_COLORS[0]
    : lineage === 'maternal' ? MATERNAL_COLORS[0]
    : SELF_COLOR;

  return {
    color,
    weight: 1.5,
    opacity: 0.5,
    dashArray: '4 4',
  };
}

/**
 * Build migration lines connecting ancestor birth locations to descendant birth locations.
 * Direction is normalized using generation numbers: always draws from higher gen (ancestor)
 * to lower gen (descendant), regardless of how parentId was assigned.
 */
export function buildMigrationLines(persons: MapPerson[]): Array<{
  from: MapCoords;
  to: MapCoords;
  lineage: 'paternal' | 'maternal' | 'self';
}> {
  const lines: Array<{ from: MapCoords; to: MapCoords; lineage: 'paternal' | 'maternal' | 'self' }> = [];
  const personMap = new Map(persons.map(p => [p.id, p]));

  for (const person of persons) {
    if (!person.parentId || !person.birthCoords) continue;
    const connected = personMap.get(person.parentId);
    if (!connected?.birthCoords) continue;

    // Don't draw line if both born in same location
    if (connected.birthCoords.lat === person.birthCoords.lat && connected.birthCoords.lng === person.birthCoords.lng) continue;

    // Always draw from ancestor (higher generation) → descendant (lower generation)
    const [ancestor, descendant] = person.generation > connected.generation
      ? [person, connected]
      : [connected, person];

    lines.push({
      from: ancestor.birthCoords!,
      to: descendant.birthCoords!,
      lineage: person.lineage,
    });
  }

  return lines;
}

/**
 * Calculate bounds that encompass all person markers
 */
export function calculateBounds(persons: MapPerson[]): L.LatLngBounds | null {
  const points: L.LatLng[] = [];

  for (const person of persons) {
    if (person.birthCoords) points.push(L.latLng(person.birthCoords.lat, person.birthCoords.lng));
    if (person.deathCoords) points.push(L.latLng(person.deathCoords.lat, person.deathCoords.lng));
  }

  if (points.length === 0) return null;
  if (points.length === 1) return points[0].toBounds(500_000);

  return L.latLngBounds(points);
}
