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
 * Escape HTML special characters to prevent XSS
 */
function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
}

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
 * Build popup HTML for a person marker
 */
export function buildPopupHtml(person: MapPerson, dbId: string): string {
  const name = escapeHtml(person.name);
  const photoUrl = person.photoUrl ? escapeHtml(person.photoUrl) : '';
  const photoHtml = photoUrl
    ? `<img src="${photoUrl}" alt="${name}" style="width:48px;height:48px;border-radius:50%;object-fit:cover;margin-right:8px;float:left;" />`
    : '';

  const genderIcon = person.gender === 'male' ? '\u2642' : person.gender === 'female' ? '\u2640' : '';
  const lineageLabel = person.lineage === 'paternal' ? 'Paternal' : person.lineage === 'maternal' ? 'Maternal' : '';
  const favoriteLabel = person.isFavorite ? ' &#11088;' : '';
  const lifespan = escapeHtml(person.lifespan);

  const places: string[] = [];
  if (person.birthPlace) places.push(`Born: ${escapeHtml(person.birthPlace)}`);
  if (person.deathPlace) places.push(`Died: ${escapeHtml(person.deathPlace)}`);

  return `
    <div style="min-width:180px;max-width:280px;">
      ${photoHtml}
      <div>
        <a href="/person/${encodeURIComponent(dbId)}/${encodeURIComponent(person.id)}" style="color:#4A90D9;font-weight:600;font-size:14px;text-decoration:none;">
          ${name}${favoriteLabel}
        </a>
        <div style="color:#888;font-size:12px;margin-top:2px;">
          ${genderIcon} ${lifespan}${lineageLabel ? ` &middot; ${lineageLabel}` : ''}${person.generation > 0 ? ` &middot; Gen ${person.generation}` : ''}
        </div>
        ${places.length > 0 ? `<div style="color:#aaa;font-size:11px;margin-top:4px;">${places.join('<br/>')}</div>` : ''}
      </div>
      <div style="clear:both;"></div>
    </div>
  `;
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
 * Build migration lines connecting parent birth locations to child birth locations
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
    const parent = personMap.get(person.parentId);
    if (!parent?.birthCoords) continue;

    // Don't draw line if parent and child born in same location
    if (parent.birthCoords.lat === person.birthCoords.lat && parent.birthCoords.lng === person.birthCoords.lng) continue;

    lines.push({
      from: parent.birthCoords,
      to: person.birthCoords,
      lineage: person.lineage,
    });
  }

  return lines;
}

/**
 * Calculate bounds that encompass all person markers
 */
export function calculateBounds(persons: MapPerson[]): L.LatLngBoundsExpression | null {
  const coords: [number, number][] = [];

  for (const person of persons) {
    if (person.birthCoords) coords.push([person.birthCoords.lat, person.birthCoords.lng]);
    if (person.deathCoords) coords.push([person.deathCoords.lat, person.deathCoords.lng]);
  }

  if (coords.length === 0) return null;
  if (coords.length === 1) {
    // Single point - create bounds around it
    return [
      [coords[0][0] - 5, coords[0][1] - 5],
      [coords[0][0] + 5, coords[0][1] + 5],
    ];
  }

  return coords as L.LatLngBoundsExpression;
}
