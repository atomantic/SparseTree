/**
 * Migration Map View
 *
 * Leaflet-based map showing ancestors plotted geographically with
 * lineage-colored markers and parent-child migration lines.
 *
 * Features:
 * - OpenStreetMap tiles (light) / CartoDB dark tiles
 * - Lineage-colored markers (paternal=blue, maternal=red)
 * - Parent-child migration polylines
 * - Time range slider filtering by birth year
 * - Layer controls for paternal/maternal toggle
 * - Auto-fit bounds on load
 * - Click popup with person details
 */

import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, Popup, useMap } from 'react-leaflet';
import type { MapPerson, MapData } from '@fsf/shared';
import { GeocodeProgressBar } from '../../map/GeocodeProgressBar';
import { Link } from 'react-router-dom';
import {
  createPersonMarker,
  getMigrationLineStyle,
  buildMigrationLines,
  calculateBounds,
} from '../../map/mapUtils';

import 'leaflet/dist/leaflet.css';

import L from 'leaflet';

interface MigrationMapViewProps {
  mapData: MapData | null;
  dbId: string;
  loading: boolean;
  onReload: () => void;
}

// Dark theme tile URL
const DARK_TILES = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
const LIGHT_TILES = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const DARK_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>';
const LIGHT_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

/**
 * Auto-fit map bounds when data changes
 */
function FitBounds({ persons }: { persons: MapPerson[] }) {
  const map = useMap();

  useEffect(() => {
    const bounds = calculateBounds(persons);
    if (bounds) {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 8 });
    }
  }, [map, persons]);

  return null;
}

function PersonPopupContent({ person, dbId }: { person: MapPerson; dbId: string }) {
  const genderIcon = person.gender === 'male' ? '\u2642' : person.gender === 'female' ? '\u2640' : '';
  const lineageLabel = person.lineage === 'paternal' ? 'Paternal' : person.lineage === 'maternal' ? 'Maternal' : '';

  return (
    <div style={{ minWidth: 180, maxWidth: 280 }}>
      {person.photoUrl && (
        <img
          src={person.photoUrl}
          alt={person.name}
          style={{ width: 48, height: 48, borderRadius: '50%', objectFit: 'cover', marginRight: 8, float: 'left' }}
        />
      )}
      <div>
        <Link
          to={`/person/${encodeURIComponent(dbId)}/${encodeURIComponent(person.id)}`}
          style={{ color: '#4A90D9', fontWeight: 600, fontSize: 14, textDecoration: 'none' }}
        >
          {person.name}{person.isFavorite && ' \u2B50'}
        </Link>
        <div style={{ color: '#888', fontSize: 12, marginTop: 2 }}>
          {genderIcon} {person.lifespan}
          {lineageLabel && ` \u00B7 ${lineageLabel}`}
          {person.generation > 0 && ` \u00B7 Gen ${person.generation}`}
        </div>
        {(person.birthPlace || person.deathPlace) && (
          <div style={{ color: '#aaa', fontSize: 11, marginTop: 4 }}>
            {person.birthPlace && <div>Born: {person.birthPlace}</div>}
            {person.deathPlace && <div>Died: {person.deathPlace}</div>}
          </div>
        )}
      </div>
      <div style={{ clear: 'both' }} />
    </div>
  );
}

export function MigrationMapView({ mapData, dbId, loading, onReload }: MigrationMapViewProps) {
  const [timeRange, setTimeRange] = useState<[number, number]>([0, 2100]);
  const [showPaternal, setShowPaternal] = useState(true);
  const [showMaternal, setShowMaternal] = useState(true);
  const [isDarkTheme, setIsDarkTheme] = useState(true);
  const mapRef = useRef<L.Map | null>(null);

  // Calculate year range from data
  const yearRange = useMemo(() => {
    if (!mapData) return { min: 0, max: 2100 };
    let min = Infinity;
    let max = -Infinity;
    for (const p of mapData.persons) {
      if (p.birthYear) {
        min = Math.min(min, p.birthYear);
        max = Math.max(max, p.birthYear);
      }
    }
    if (!isFinite(min)) return { min: 0, max: 2100 };
    // Round to nearest 50
    return { min: Math.floor(min / 50) * 50, max: Math.ceil(max / 50) * 50 };
  }, [mapData]);

  // Initialize time range when data loads
  useEffect(() => {
    setTimeRange([yearRange.min, yearRange.max]);
  }, [yearRange.min, yearRange.max]);

  // Filter persons by time range and lineage visibility
  const filteredPersons = useMemo(() => {
    if (!mapData) return [];
    return mapData.persons.filter(p => {
      // Lineage filter
      if (p.lineage === 'paternal' && !showPaternal) return false;
      if (p.lineage === 'maternal' && !showMaternal) return false;

      // Time filter (only filter if person has a birth year)
      if (p.birthYear && (p.birthYear < timeRange[0] || p.birthYear > timeRange[1])) return false;

      // Must have at least one geocoded coordinate
      return p.birthCoords || p.deathCoords;
    });
  }, [mapData, showPaternal, showMaternal, timeRange]);

  // Build migration lines
  const migrationLines = useMemo(() => {
    return buildMigrationLines(filteredPersons);
  }, [filteredPersons]);

  // Count markers with coords
  const markersWithCoords = filteredPersons.filter(p => p.birthCoords || p.deathCoords).length;

  const handleTimeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseInt(e.target.value);
    const isMin = e.target.dataset.range === 'min';
    setTimeRange(prev => isMin
      ? [value, Math.max(value, prev[1])]
      : [Math.min(prev[0], value), value]
    );
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-app-male border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-app-text-muted">Loading map data...</p>
        </div>
      </div>
    );
  }

  // Empty state - based on total data (not filtered) to avoid showing empty state from filters
  const totalWithCoords = mapData ? mapData.persons.filter(p => p.birthCoords || p.deathCoords).length : 0;
  if (!mapData || totalWithCoords === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center max-w-md px-4">
          <div className="text-4xl mb-4">{'\u{1F5FA}'}</div>
          <h3 className="text-lg font-semibold text-app-text mb-2">No Map Data Available</h3>
          <p className="text-app-text-muted text-sm mb-4">
            Place data needs to be geocoded before it can be plotted on the map.
            Click "Geocode Places" below to resolve place names to coordinates.
          </p>
          {mapData && (
            <GeocodeProgressBar
              ungeocoded={mapData.ungeocoded}
              geocodeStats={mapData.geocodeStats}
              dbId={dbId}
              onComplete={onReload}
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Geocode banner if there are ungeocoded places */}
      {mapData.ungeocoded.length > 0 && (
        <GeocodeProgressBar
          ungeocoded={mapData.ungeocoded}
          geocodeStats={mapData.geocodeStats}
          dbId={dbId}
          onComplete={onReload}
        />
      )}

      {/* Controls bar */}
      <div className="flex flex-wrap items-center gap-3 px-3 py-2 bg-app-card border-b border-app-border text-sm">
        {/* Lineage toggles */}
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 cursor-pointer">
            <input
              type="checkbox"
              checked={showPaternal}
              onChange={(e) => setShowPaternal(e.target.checked)}
              className="accent-blue-500"
            />
            <span className="text-blue-400">Paternal</span>
          </label>
          <label className="flex items-center gap-1 cursor-pointer">
            <input
              type="checkbox"
              checked={showMaternal}
              onChange={(e) => setShowMaternal(e.target.checked)}
              className="accent-red-500"
            />
            <span className="text-red-400">Maternal</span>
          </label>
        </div>

        {/* Divider */}
        <div className="w-px h-4 bg-app-border" />

        {/* Time range slider */}
        <div className="flex items-center gap-2 flex-1 min-w-[200px]">
          <span className="text-app-text-muted whitespace-nowrap">{timeRange[0]}</span>
          <input
            type="range"
            data-range="min"
            min={yearRange.min}
            max={yearRange.max}
            value={timeRange[0]}
            onChange={handleTimeChange}
            className="flex-1 h-1 accent-blue-500"
          />
          <input
            type="range"
            data-range="max"
            min={yearRange.min}
            max={yearRange.max}
            value={timeRange[1]}
            onChange={handleTimeChange}
            className="flex-1 h-1 accent-red-500"
          />
          <span className="text-app-text-muted whitespace-nowrap">{timeRange[1]}</span>
        </div>

        {/* Divider */}
        <div className="w-px h-4 bg-app-border" />

        {/* Theme toggle */}
        <button
          onClick={() => setIsDarkTheme(!isDarkTheme)}
          className="px-2 py-1 rounded text-xs bg-app-bg border border-app-border hover:bg-app-hover"
          title={isDarkTheme ? 'Switch to light map' : 'Switch to dark map'}
        >
          {isDarkTheme ? '\u{2600}' : '\u{1F319}'}
        </button>

        {/* Stats */}
        <span className="text-app-text-muted text-xs">
          {markersWithCoords} ancestors plotted
        </span>
      </div>

      {/* Map */}
      <div className="flex-1">
        <MapContainer
          center={[30, 0]}
          zoom={3}
          style={{ width: '100%', height: '100%' }}
          ref={mapRef}
        >
          <TileLayer
            key={isDarkTheme ? 'dark' : 'light'}
            url={isDarkTheme ? DARK_TILES : LIGHT_TILES}
            attribution={isDarkTheme ? DARK_ATTR : LIGHT_ATTR}
          />

          <FitBounds persons={filteredPersons} />

          {/* Migration lines */}
          {migrationLines.map((line, i) => (
            <Polyline
              key={`line-${i}`}
              positions={[[line.from.lat, line.from.lng], [line.to.lat, line.to.lng]]}
              pathOptions={getMigrationLineStyle(line.lineage)}
            />
          ))}

          {/* Person markers - birth locations */}
          {filteredPersons.map(person => {
            const coords = person.birthCoords || person.deathCoords;
            if (!coords) return null;
            return (
              <Marker
                key={`marker-${person.id}`}
                position={[coords.lat, coords.lng]}
                icon={createPersonMarker(person)}
              >
                <Popup>
                  <PersonPopupContent person={person} dbId={dbId} />
                </Popup>
              </Marker>
            );
          })}
        </MapContainer>
      </div>
    </div>
  );
}
