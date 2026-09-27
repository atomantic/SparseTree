import type { SearchParams } from '@fsf/shared';
import { databaseService } from './database.service.js';

// Search shares core reads' PostgreSQL availability and JSON fallback policy.
export const searchService = {
  search: (dbId: string, params: SearchParams) => databaseService.search(dbId, params),
  quickSearch: (dbId: string, q: string) => databaseService.quickSearch(dbId, q),
};
