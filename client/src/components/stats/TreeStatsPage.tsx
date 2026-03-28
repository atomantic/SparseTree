import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  BarChart3,
  Users,
  Heart,
  Camera,
  MapPin,
  Calendar,
  Link2,
  ArrowLeft,
  Loader2,
  Star,
  Type,
  Clock,
  Briefcase,
} from 'lucide-react';
import type { TreeStats, DatabaseInfo } from '@fsf/shared';
import { api } from '../../services/api';

// Provider display labels
const PROVIDER_LABELS: Record<string, string> = {
  familysearch: 'FamilySearch',
  ancestry: 'Ancestry',
  wikitree: 'WikiTree',
  '23andme': '23andMe',
  geni: 'Geni',
  myheritage: 'MyHeritage',
  findmypast: 'FindMyPast',
};

// Provider badge colors
const PROVIDER_COLORS: Record<string, string> = {
  familysearch: 'bg-blue-600/20 text-blue-400',
  ancestry: 'bg-emerald-600/20 text-emerald-400',
  wikitree: 'bg-purple-600/20 text-purple-400',
  '23andme': 'bg-pink-600/20 text-pink-400',
  geni: 'bg-cyan-600/20 text-cyan-400',
  myheritage: 'bg-orange-600/20 text-orange-400',
  findmypast: 'bg-amber-600/20 text-amber-400',
};

function ProgressBar({ value, total, color = 'bg-app-accent' }: { value: number; total: number; color?: string }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 h-2 bg-app-border rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs text-app-text-muted w-14 text-right">
        {pct}% <span className="text-[10px]">({value.toLocaleString()})</span>
      </span>
    </div>
  );
}

function StatCard({ icon, label, value, subtext }: { icon: React.ReactNode; label: string; value: string | number; subtext?: string }) {
  return (
    <div className="bg-app-card border border-app-border rounded-lg p-4">
      <div className="flex items-center gap-2 text-app-text-muted mb-1">
        {icon}
        <span className="text-xs uppercase tracking-wider">{label}</span>
      </div>
      <div className="text-2xl font-bold text-app-text">{typeof value === 'number' ? value.toLocaleString() : value}</div>
      {subtext && <div className="text-xs text-app-text-muted mt-1">{subtext}</div>}
    </div>
  );
}

function centuryLabel(century: number): string {
  if (century < 0) return `${Math.abs(century) + 1}th c. BC`;
  const c = century + 1;
  const suffix = c === 1 ? 'st' : c === 2 ? 'nd' : c === 3 ? 'rd' : 'th';
  return `${c}${suffix} c.`;
}

export function TreeStatsPage() {
  const { dbId } = useParams<{ dbId: string }>();
  const [stats, setStats] = useState<TreeStats | null>(null);
  const [database, setDatabase] = useState<DatabaseInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!dbId) return;

    Promise.all([
      api.getTreeStats(dbId),
      api.getDatabase(dbId),
    ])
      .then(([statsData, dbData]) => {
        setStats(statsData);
        setDatabase(dbData);
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [dbId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="animate-spin text-app-accent" size={24} />
        <span className="ml-2 text-app-text-muted">Loading statistics...</span>
      </div>
    );
  }

  if (error || !stats) {
    return (
      <div className="p-6">
        <div className="text-app-error text-center py-8">
          {error || 'Failed to load statistics'}
        </div>
      </div>
    );
  }

  const maxCenturyCount = Math.max(...stats.centuries.map(c => c.count), 1);
  const maxGenCount = Math.max(...stats.generations.map(g => g.count), 1);

  return (
    <div className="p-3 sm:p-4 md:p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link
          to="/"
          className="p-2 min-h-[40px] min-w-[40px] flex items-center justify-center text-app-text-muted hover:text-app-accent hover:bg-app-accent/10 rounded transition-colors"
          title="Back to roots"
        >
          <ArrowLeft size={18} />
        </Link>
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-app-text flex items-center gap-2">
            <BarChart3 size={22} />
            Tree Statistics
          </h1>
          {database?.rootName && (
            <p className="text-sm text-app-text-muted mt-0.5">{database.rootName}</p>
          )}
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <StatCard
          icon={<Users size={14} />}
          label="Total People"
          value={stats.totalPersons}
        />
        <StatCard
          icon={<Star size={14} />}
          label="Favorites"
          value={stats.favorites}
        />
        <StatCard
          icon={<Link2 size={14} />}
          label="Providers"
          value={Object.keys(stats.providers).length}
          subtext={Object.values(stats.providers).reduce((a, b) => a + b, 0).toLocaleString() + ' links'}
        />
        <StatCard
          icon={<Camera size={14} />}
          label="With Photos"
          value={stats.completeness.hasPhoto}
          subtext={stats.totalPersons > 0 ? `${Math.round((stats.completeness.hasPhoto / stats.totalPersons) * 100)}% coverage` : ''}
        />
      </div>

      {/* Gender breakdown */}
      <div className="bg-app-card border border-app-border rounded-lg p-4 mb-4">
        <h2 className="text-sm font-semibold text-app-text mb-3 flex items-center gap-2">
          <Users size={14} />
          Gender Distribution
        </h2>
        <div className="grid grid-cols-3 gap-4 text-center">
          <div>
            <div className="text-lg font-bold text-blue-400">{stats.gender.male.toLocaleString()}</div>
            <div className="text-xs text-app-text-muted">Male</div>
            <div className="text-xs text-app-text-muted">
              {stats.totalPersons > 0 ? `${Math.round((stats.gender.male / stats.totalPersons) * 100)}%` : '0%'}
            </div>
          </div>
          <div>
            <div className="text-lg font-bold text-pink-400">{stats.gender.female.toLocaleString()}</div>
            <div className="text-xs text-app-text-muted">Female</div>
            <div className="text-xs text-app-text-muted">
              {stats.totalPersons > 0 ? `${Math.round((stats.gender.female / stats.totalPersons) * 100)}%` : '0%'}
            </div>
          </div>
          <div>
            <div className="text-lg font-bold text-app-text-muted">{stats.gender.unknown.toLocaleString()}</div>
            <div className="text-xs text-app-text-muted">Unknown</div>
            <div className="text-xs text-app-text-muted">
              {stats.totalPersons > 0 ? `${Math.round((stats.gender.unknown / stats.totalPersons) * 100)}%` : '0%'}
            </div>
          </div>
        </div>
      </div>

      {/* Lifespan Statistics */}
      {stats.lifespans?.overall && (
        <div className="bg-app-card border border-app-border rounded-lg p-4 mb-4">
          <h2 className="text-sm font-semibold text-app-text mb-3 flex items-center gap-2">
            <Clock size={14} />
            Average Lifespan
          </h2>

          {/* Overall + by gender */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center mb-4">
            <div>
              <div className="text-lg font-bold text-app-accent">{stats.lifespans.overall.avgAge}</div>
              <div className="text-xs text-app-text-muted">Overall avg</div>
              <div className="text-[10px] text-app-text-muted">{stats.lifespans.overall.count.toLocaleString()} people</div>
            </div>
            {stats.lifespans.byGender.map(({ gender, avgAge, count }) => (
              <div key={gender}>
                <div className={`text-lg font-bold ${gender === 'male' ? 'text-blue-400' : gender === 'female' ? 'text-pink-400' : 'text-app-text-muted'}`}>
                  {avgAge}
                </div>
                <div className="text-xs text-app-text-muted capitalize">{gender}</div>
                <div className="text-[10px] text-app-text-muted">{count.toLocaleString()} people</div>
              </div>
            ))}
          </div>

          {/* By century */}
          {stats.lifespans.byCentury.length > 0 && (
            <>
              <div className="text-xs text-app-text-muted mb-2">Average age at death by birth century</div>
              <div className="flex items-end gap-1 h-32">
                {stats.lifespans.byCentury.map(({ century, avgAge, count }) => {
                  const maxAge = Math.max(...stats.lifespans.byCentury.map(c => c.avgAge), 1);
                  return (
                    <div key={century} className="flex-1 flex flex-col items-center justify-end h-full min-w-0">
                      <span className="text-[9px] text-app-text-muted mb-1">{avgAge}</span>
                      <div
                        className="w-full bg-teal-500/60 rounded-t hover:bg-teal-500 transition-colors"
                        style={{ height: `${Math.max((avgAge / maxAge) * 80, 4)}%` }}
                        title={`${centuryLabel(century)}: avg ${avgAge} years (${count.toLocaleString()} people)`}
                      />
                      <span className="text-[9px] sm:text-[10px] text-app-text-muted mt-1 truncate w-full text-center">
                        {centuryLabel(century)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {/* Data Completeness */}
      <div className="bg-app-card border border-app-border rounded-lg p-4 mb-4">
        <h2 className="text-sm font-semibold text-app-text mb-3 flex items-center gap-2">
          <Heart size={14} />
          Data Completeness
        </h2>
        <div className="space-y-3">
          <div>
            <div className="flex items-center gap-1.5 text-xs text-app-text-muted mb-1">
              <Calendar size={12} /> Birth Date
            </div>
            <ProgressBar value={stats.completeness.hasBirthDate} total={stats.totalPersons} color="bg-green-500" />
          </div>
          <div>
            <div className="flex items-center gap-1.5 text-xs text-app-text-muted mb-1">
              <MapPin size={12} /> Birth Place
            </div>
            <ProgressBar value={stats.completeness.hasBirthPlace} total={stats.totalPersons} color="bg-green-500" />
          </div>
          <div>
            <div className="flex items-center gap-1.5 text-xs text-app-text-muted mb-1">
              <Calendar size={12} /> Death Date
            </div>
            <ProgressBar value={stats.completeness.hasDeathDate} total={stats.totalPersons} color="bg-amber-500" />
          </div>
          <div>
            <div className="flex items-center gap-1.5 text-xs text-app-text-muted mb-1">
              <MapPin size={12} /> Death Place
            </div>
            <ProgressBar value={stats.completeness.hasDeathPlace} total={stats.totalPersons} color="bg-amber-500" />
          </div>
          <div>
            <div className="flex items-center gap-1.5 text-xs text-app-text-muted mb-1">
              <Camera size={12} /> Photo
            </div>
            <ProgressBar value={stats.completeness.hasPhoto} total={stats.totalPersons} color="bg-blue-500" />
          </div>
        </div>
      </div>

      {/* Provider Coverage */}
      {Object.keys(stats.providers).length > 0 && (
        <div className="bg-app-card border border-app-border rounded-lg p-4 mb-4">
          <h2 className="text-sm font-semibold text-app-text mb-3 flex items-center gap-2">
            <Link2 size={14} />
            Provider Coverage
          </h2>
          <div className="space-y-2">
            {Object.entries(stats.providers)
              .sort(([, a], [, b]) => b - a)
              .map(([provider, count]) => (
                <div key={provider} className="flex items-center gap-3">
                  <span className={`text-xs px-2 py-0.5 rounded font-medium min-w-[90px] text-center ${PROVIDER_COLORS[provider] ?? 'bg-app-text-muted/20 text-app-text-muted'}`}>
                    {PROVIDER_LABELS[provider] ?? provider}
                  </span>
                  <div className="flex-1">
                    <ProgressBar value={count} total={stats.totalPersons} color="bg-app-accent" />
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Top Surnames */}
      {stats.surnames.length > 0 && (() => {
        const maxSurnameCount = Math.max(...stats.surnames.map(s => s.count), 1);
        return (
          <div className="bg-app-card border border-app-border rounded-lg p-4 mb-4">
            <h2 className="text-sm font-semibold text-app-text mb-3 flex items-center gap-2">
              <Type size={14} />
              Top Surnames
            </h2>
            <div className="space-y-1.5 max-h-64 overflow-y-auto">
              {stats.surnames.map(({ surname, count }) => (
                <div key={surname} className="flex items-center gap-2">
                  <span className="text-xs text-app-text truncate w-28 text-right shrink-0" title={surname}>
                    {surname}
                  </span>
                  <div className="flex-1 h-4 bg-app-border rounded overflow-hidden">
                    <div
                      className="h-full bg-purple-500/50 rounded transition-all"
                      style={{ width: `${Math.max((count / maxSurnameCount) * 100, 1)}%` }}
                    />
                  </div>
                  <span className="text-xs text-app-text-muted w-10 text-right shrink-0">{count}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Top Occupations */}
      {stats.occupations?.length > 0 && (() => {
        const maxOccCount = Math.max(...stats.occupations.map(o => o.count), 1);
        return (
          <div className="bg-app-card border border-app-border rounded-lg p-4 mb-4">
            <h2 className="text-sm font-semibold text-app-text mb-3 flex items-center gap-2">
              <Briefcase size={14} />
              Top Occupations
            </h2>
            <div className="space-y-1.5 max-h-64 overflow-y-auto">
              {stats.occupations.map(({ occupation, count }) => (
                <div key={occupation} className="flex items-center gap-2">
                  <span className="text-xs text-app-text truncate w-32 text-right shrink-0" title={occupation}>
                    {occupation}
                  </span>
                  <div className="flex-1 h-4 bg-app-border rounded overflow-hidden">
                    <div
                      className="h-full bg-amber-500/50 rounded transition-all"
                      style={{ width: `${Math.max((count / maxOccCount) * 100, 1)}%` }}
                    />
                  </div>
                  <span className="text-xs text-app-text-muted w-10 text-right shrink-0">{count}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Top Birth Countries */}
      {stats.birthCountries?.length > 0 && (() => {
        const maxCountryCount = Math.max(...stats.birthCountries.map(c => c.count), 1);
        return (
          <div className="bg-app-card border border-app-border rounded-lg p-4 mb-4">
            <h2 className="text-sm font-semibold text-app-text mb-3 flex items-center gap-2">
              <MapPin size={14} />
              Top Birth Countries
            </h2>
            <div className="space-y-1.5 max-h-64 overflow-y-auto">
              {stats.birthCountries.map(({ country, count }) => (
                <div key={country} className="flex items-center gap-2">
                  <span className="text-xs text-app-text truncate w-32 text-right shrink-0" title={country}>
                    {country}
                  </span>
                  <div className="flex-1 h-4 bg-app-border rounded overflow-hidden">
                    <div
                      className="h-full bg-cyan-500/50 rounded transition-all"
                      style={{ width: `${Math.max((count / maxCountryCount) * 100, 1)}%` }}
                    />
                  </div>
                  <span className="text-xs text-app-text-muted w-10 text-right shrink-0">{count}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Top Birth Places */}
      {stats.birthPlaces?.length > 0 && (() => {
        const maxPlaceCount = Math.max(...stats.birthPlaces.map(p => p.count), 1);
        return (
          <div className="bg-app-card border border-app-border rounded-lg p-4 mb-4">
            <h2 className="text-sm font-semibold text-app-text mb-3 flex items-center gap-2">
              <MapPin size={14} />
              Top Birth Places
            </h2>
            <div className="space-y-1.5 max-h-64 overflow-y-auto">
              {stats.birthPlaces.map(({ place, count }) => (
                <div key={place} className="flex items-center gap-2">
                  <span className="text-xs text-app-text truncate w-40 text-right shrink-0" title={place}>
                    {place}
                  </span>
                  <div className="flex-1 h-4 bg-app-border rounded overflow-hidden">
                    <div
                      className="h-full bg-emerald-500/50 rounded transition-all"
                      style={{ width: `${Math.max((count / maxPlaceCount) * 100, 1)}%` }}
                    />
                  </div>
                  <span className="text-xs text-app-text-muted w-10 text-right shrink-0">{count}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Century Distribution */}
      {stats.centuries.length > 0 && (
        <div className="bg-app-card border border-app-border rounded-lg p-4 mb-4">
          <h2 className="text-sm font-semibold text-app-text mb-3 flex items-center gap-2">
            <Calendar size={14} />
            Ancestors by Century
          </h2>
          <div className="flex items-end gap-1 h-32">
            {stats.centuries.map(({ century, count }) => (
              <div key={century} className="flex-1 flex flex-col items-center justify-end h-full min-w-0">
                <div
                  className="w-full bg-app-accent/60 rounded-t hover:bg-app-accent transition-colors"
                  style={{ height: `${Math.max((count / maxCenturyCount) * 100, 2)}%` }}
                  title={`${centuryLabel(century)}: ${count.toLocaleString()} people`}
                />
                <span className="text-[9px] sm:text-[10px] text-app-text-muted mt-1 truncate w-full text-center">
                  {centuryLabel(century)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Generation Distribution */}
      {stats.generations.length > 0 && (
        <div className="bg-app-card border border-app-border rounded-lg p-4">
          <h2 className="text-sm font-semibold text-app-text mb-3 flex items-center gap-2">
            <BarChart3 size={14} />
            Ancestors by Generation
          </h2>
          <div className="space-y-1.5 max-h-64 overflow-y-auto">
            {stats.generations.map(({ generation, count }) => (
              <div key={generation} className="flex items-center gap-2">
                <span className="text-xs text-app-text-muted w-12 text-right shrink-0">Gen {generation}</span>
                <div className="flex-1 h-4 bg-app-border rounded overflow-hidden">
                  <div
                    className="h-full bg-app-accent/50 rounded transition-all"
                    style={{ width: `${Math.max((count / maxGenCount) * 100, 1)}%` }}
                  />
                </div>
                <span className="text-xs text-app-text-muted w-10 text-right shrink-0">{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
