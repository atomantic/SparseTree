/**
 * Sparse Tree Map Page
 *
 * Standalone page for viewing favorites plotted on a migration map.
 * Accessible at /favorites/sparse-tree/:dbId/map
 */

import { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import type { MapData } from '@fsf/shared';
import { api } from '../../services/api';
import { MigrationMapView } from '../ancestry-tree/views/MigrationMapView';

export function SparseTreeMapPage() {
  const { dbId } = useParams<{ dbId: string }>();
  const [mapData, setMapData] = useState<MapData | null>(null);
  const [loading, setLoading] = useState(true);
  const [dbName, setDbName] = useState<string>('');

  const loadMapData = useCallback(async () => {
    if (!dbId) return;
    setLoading(true);
    const [data, dbInfo] = await Promise.all([
      api.getSparseTreeMapData(dbId).catch(() => null),
      api.getDatabase(dbId).catch(() => null),
    ]);
    setMapData(data);
    if (dbInfo?.rootName) setDbName(dbInfo.rootName);
    setLoading(false);
  }, [dbId]);

  useEffect(() => {
    loadMapData();
  }, [loadMapData]);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-4 px-4 py-3 border-b border-app-border bg-app-card">
        <Link
          to={`/favorites/sparse-tree/${dbId}`}
          className="text-app-text-muted hover:text-app-text text-sm"
        >
          {'\u{2190}'} Sparse Tree
        </Link>
        <h1 className="text-lg font-bold text-app-text">
          {'\u{1F5FA}'} Favorites Migration Map
        </h1>
        {dbName && <span className="text-sm text-app-text-muted">{dbName}</span>}
      </div>

      {/* Map */}
      <div className="flex-1">
        <MigrationMapView
          mapData={mapData}
          dbId={dbId || ''}
          loading={loading}
          onReload={loadMapData}
        />
      </div>
    </div>
  );
}
