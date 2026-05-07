import { fetchJson } from './api';

export interface DeathInfo {
  personId: string;
  cause: string | null;
  circumstance: string | null;
  isUnusualManual: boolean;
  isUnusualAuto: boolean;
  isUnusual: boolean;
  matchedKeywords: string[];
  causeIsLocal: boolean;
  circumstanceIsLocal: boolean;
}

export interface DeathListItem extends DeathInfo {
  displayName: string;
  birthYear: number | null;
  deathYear: number | null;
  deathPlace: string | null;
}

export interface DeathListResult {
  items: DeathListItem[];
  total: number;
  limit: number;
  offset: number;
}

export const deathsApi = {
  list: (params: {
    q?: string;
    unusual?: boolean;
    dbId?: string;
    limit?: number;
    offset?: number;
  } = {}) => {
    const qs = new URLSearchParams();
    if (params.q) qs.set('q', params.q);
    if (params.unusual) qs.set('unusual', '1');
    if (params.dbId) qs.set('dbId', params.dbId);
    if (params.limit !== undefined) qs.set('limit', String(params.limit));
    if (params.offset !== undefined) qs.set('offset', String(params.offset));
    const query = qs.toString();
    return fetchJson<DeathListResult>(`/deaths${query ? `?${query}` : ''}`);
  },

  get: (personId: string) => fetchJson<DeathInfo>(`/deaths/${personId}`),

  set: (
    personId: string,
    updates: {
      cause?: string | null;
      circumstance?: string | null;
      isUnusualManual?: boolean;
      reason?: string;
    }
  ) =>
    fetchJson<DeathInfo>(`/deaths/${personId}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    }),

  listKeywords: () => fetchJson<string[]>('/deaths/keywords'),

  addKeyword: (keyword: string) =>
    fetchJson<string[]>('/deaths/keywords', {
      method: 'POST',
      body: JSON.stringify({ keyword }),
    }),

  removeKeyword: (keyword: string) =>
    fetchJson<{ removed: boolean; keywords: string[] }>(
      `/deaths/keywords/${encodeURIComponent(keyword)}`,
      { method: 'DELETE' }
    ),
};
