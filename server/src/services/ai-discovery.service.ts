import { databaseService } from './database.service.js';
import { favoritesService, PRESET_TAGS } from './favorites.service.js';
import { idMappingService } from './id-mapping.service.js';
import { postgresService } from '../db/postgres.service.js';
import { getAIToolkit } from './ai-toolkit.service.js';
import { logger } from '../lib/logger.js';
import type { Person } from '@fsf/shared';

/**
 * Safe JSON parse that returns null instead of throwing
 */
function safeJsonParse(str: string): unknown {
  const [result, error] = (() => { try { return [JSON.parse(str), null]; } catch (e) { return [null, e]; } })();
  if (error) logger.error('ai-discovery', `🔍 JSON parse error: ${(error as Error).message}`);
  return result;
}

/**
 * Execute AI prompt using the configured AI toolkit provider
 */
class DiscoveryCancelledError extends Error {
  constructor() {
    super('Discovery cancelled');
    this.name = 'DiscoveryCancelledError';
  }
}

export class DiscoveryInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DiscoveryInputError';
  }
}

export class DiscoveryRunConflictError extends Error {
  constructor(public readonly runId: string) {
    super(`A discovery run is already active for this database (${runId}).`);
    this.name = 'DiscoveryRunConflictError';
  }
}

function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DiscoveryCancelledError();
}

async function executeAiPrompt(prompt: string, timeoutMs = 300000, signal?: AbortSignal): Promise<string> {
  throwIfCancelled(signal);
  const startTime = Date.now();
  const toolkit = getAIToolkit();
  const { providers, runner } = toolkit.services;

  const activeProvider = await providers.getActiveProvider();
  if (!activeProvider) {
    throw new Error('No active AI provider configured. Please configure one in Settings > AI.');
  }

  if (!activeProvider.enabled) {
    throw new Error(`AI provider "${activeProvider.name}" is disabled.`);
  }

  logger.start('ai-discovery', `Invoking ${activeProvider.name} (${activeProvider.type}), prompt: ${prompt.length} chars`);

  const { runId, provider, timeout } = await runner.createRun({
    providerId: activeProvider.id,
    prompt,
    timeout: timeoutMs,
    source: 'ai-discovery'
  });

  throwIfCancelled(signal);

  return new Promise((resolve, reject) => {
    let output = '';
    let settled = false;

    let timeoutHandle: NodeJS.Timeout | undefined;

    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      if (timeoutHandle) clearTimeout(timeoutHandle);
      signal?.removeEventListener('abort', onAbort);
      callback();
    };

    const onData = (data: string | { text?: string; isReasoning?: boolean }) => {
      if (typeof data !== 'string' && data.isReasoning) return;
      output += typeof data === 'string' ? data : data.text ?? '';
    };

    const onComplete = (metadata: { success: boolean; error?: string; errorDetails?: string; duration?: number }) => {
      const elapsed = Date.now() - startTime;
      if (metadata.success) {
        logger.done('ai-discovery', `${activeProvider.name} completed in ${elapsed}ms, response: ${output.length} chars`);
        settle(() => resolve(output));
      } else {
        const errorMsg = metadata.errorDetails || metadata.error || 'Unknown error';
        logger.error('ai-discovery', `${activeProvider.name} failed after ${elapsed}ms: ${metadata.error || 'Unknown error'}`);
        if (metadata.errorDetails) {
          logger.error('ai-discovery', `Error details: ${metadata.errorDetails}`);
        }
        settle(() => reject(new Error(`AI run failed: ${errorMsg}`)));
      }
    };

    const stopProviderRun = () => {
      void runner.stopRun(runId).catch((err: Error) => {
        logger.warn('ai-discovery', `Failed to stop provider run ${runId}: ${err.message}`);
      });
    };

    const onAbort = () => {
      logger.warn('ai-discovery', `Cancelling provider run ${runId}`);
      stopProviderRun();
      settle(() => reject(new DiscoveryCancelledError()));
    };

    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }

    timeoutHandle = setTimeout(() => {
      logger.error('ai-discovery', `Provider run ${runId} timed out after ${timeoutMs}ms`);
      stopProviderRun();
      settle(() => reject(new Error(`AI discovery provider timed out after ${timeoutMs}ms`)));
    }, timeoutMs);

    const execution = provider.type === 'cli'
      ? runner.executeCliRun(runId, provider, prompt, process.cwd(), onData, onComplete, timeout || timeoutMs)
      : runner.executeApiRun(runId, provider, provider.defaultModel, prompt, process.cwd(), null, onData, onComplete);
    void execution.catch((err: Error) => settle(() => reject(err)));
  });
}

export interface DiscoveryCandidate {
  personId: string;
  externalId?: string;
  name: string;
  lifespan: string;
  birthPlace?: string;
  deathPlace?: string;
  occupations?: string[];
  bio?: string;
  whyInteresting: string;
  suggestedTags: string[];
  confidence: 'high' | 'medium' | 'low';
}

export interface DiscoveryResult {
  dbId: string;
  candidates: DiscoveryCandidate[];
  totalAnalyzed: number;
  runId: string;
}

export interface DiscoveryProgress {
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  totalPersons: number;
  analyzedPersons: number;
  candidatesFound: number;
  currentBatch: number;
  totalBatches: number;
  error?: string;
}

// Store for tracking discovery runs and their results
const MAX_STORED_RUNS = 100;
export const FULL_DISCOVERY_LIMITS = {
  defaultBatchSize: 50,
  maxBatchSize: 100,
  defaultMaxPersons: 500,
  maxPersons: 1000,
} as const;

export interface FullDiscoveryOptions {
  batchSize?: number;
  maxPersons?: number;
}

export interface NormalizedFullDiscoveryOptions {
  batchSize: number;
  maxPersons: number;
}

const discoveryRuns = new Map<string, DiscoveryProgress>();
const discoveryResults = new Map<string, DiscoveryResult>();
const activeDiscoveryRuns = new Map<string, { runId: string; controller: AbortController }>();
let discoveryRunCounter = 0;

function createDiscoveryRunId(dbId: string): string {
  discoveryRunCounter += 1;
  return `discovery-${dbId}-${Date.now()}-${discoveryRunCounter}`;
}

function normalizeBoundedInteger(
  value: unknown,
  fallback: number,
  maximum: number,
  field: 'batchSize' | 'maxPersons',
): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > maximum) {
    throw new DiscoveryInputError(`${field} must be a positive integer no greater than ${maximum}`);
  }
  return value;
}

/** Validate request and programmatic full-discovery options before a run is created. */
export function normalizeFullDiscoveryOptions(options?: FullDiscoveryOptions): NormalizedFullDiscoveryOptions {
  return {
    batchSize: normalizeBoundedInteger(
      options?.batchSize,
      FULL_DISCOVERY_LIMITS.defaultBatchSize,
      FULL_DISCOVERY_LIMITS.maxBatchSize,
      'batchSize',
    ),
    maxPersons: normalizeBoundedInteger(
      options?.maxPersons,
      FULL_DISCOVERY_LIMITS.defaultMaxPersons,
      FULL_DISCOVERY_LIMITS.maxPersons,
      'maxPersons',
    ),
  };
}

function evictOldestRun(): void {
  if (discoveryRuns.size >= MAX_STORED_RUNS) {
    const activeRunIds = new Set([...activeDiscoveryRuns.values()].map(({ runId }) => runId));
    const oldestKey = [...discoveryRuns.keys()].find(runId => !activeRunIds.has(runId));
    if (oldestKey) {
      discoveryRuns.delete(oldestKey);
      discoveryResults.delete(oldestKey);
    }
  }
}

function buildPersonSummary(person: Person & { canonicalId?: string }, personId: string): string {
  const parts: string[] = [];
  parts.push(person.name);
  if (person.lifespan) parts.push(person.lifespan);
  if (person.birth?.place) parts.push(`b:${person.birth.place}`);
  if (person.occupations?.length) parts.push(`occ:${person.occupations.slice(0, 3).join(',')}`);
  if (person.bio) parts.push(`bio:${person.bio.substring(0, 200)}...`);
  return `[${personId}] ${parts.join(' | ')}`;
}

function buildDiscoveryPrompt(personSummaries: string[], _existingFavoriteIds: Set<string>, customPrompt?: string): string {
  const customSection = customPrompt
    ? `\nSPECIFIC SEARCH CRITERIA:\n${customPrompt}\n\nFocus on finding ancestors that match the above criteria, but also note any other particularly interesting people.\n`
    : '';

  return `Analyze these genealogical records and identify interesting ancestors. Return ONLY a JSON array.
${customSection}
TAGS: ${PRESET_TAGS.join(', ')}

RECORDS:
${personSummaries.join('\n')}

Return JSON array of interesting people:
[{"personId":"ID_IN_BRACKETS","whyInteresting":"reason","suggestedTags":["tag"],"confidence":"high|medium|low"}]

Return [] if none interesting.`;
}

function parseAiResponse(response: string): Array<{
  personId: string;
  whyInteresting: string;
  suggestedTags: string[];
  confidence: 'high' | 'medium' | 'low';
}> {
  // Find the last occurrence of "personId" and scan backward to find the enclosing array
  const personIdIndex = response.lastIndexOf('"personId"');
  if (personIdIndex === -1) return [];

  let startPos = -1;
  for (let i = personIdIndex; i >= 0; i--) {
    if (response[i] === '[') { startPos = i; break; }
    if (response[i] === ']') break; // hit a closing bracket first — not inside an array
  }

  if (startPos === -1) return [];
  return parseJsonFromPosition(response, startPos);
}

function parseJsonFromPosition(response: string, startPos: number): Array<{
  personId: string;
  whyInteresting: string;
  suggestedTags: string[];
  confidence: 'high' | 'medium' | 'low';
}> {
  // Find the matching closing bracket by counting
  let depth = 0;
  let endPos = startPos;
  for (let i = startPos; i < response.length; i++) {
    if (response[i] === '[') depth++;
    else if (response[i] === ']') {
      depth--;
      if (depth === 0) {
        endPos = i + 1;
        break;
      }
    }
  }

  if (endPos <= startPos) return [];

  const jsonStr = response.substring(startPos, endPos);
  const parseResult = safeJsonParse(jsonStr);
  if (!parseResult || !Array.isArray(parseResult)) {
    logger.error('ai-discovery', `🔍 Failed to parse AI discovery JSON response`);
    return [];
  }
  const parsed = parseResult;

  return (parsed as any[]).filter(item =>
    item.personId &&
    item.whyInteresting &&
    Array.isArray(item.suggestedTags) &&
    ['high', 'medium', 'low'].includes(item.confidence)
  );
}

type DismissalStore = Pick<typeof postgresService, 'run' | 'queryOne'>;

async function resolveDismissalPersonId(store: DismissalStore, personId: string): Promise<string | undefined> {
  const row = await store.queryOne<{ person_id: string }>(
    `SELECT person_id FROM person WHERE person_id = @personId
     UNION ALL
     SELECT person_id FROM external_identity WHERE source = 'familysearch' AND external_id = @personId
     LIMIT 1`,
    { personId },
  );
  return row?.person_id;
}

async function writeDismissal(
  store: DismissalStore,
  dbId: string,
  personId: string,
  aiReason?: string,
  aiTags?: string[],
): Promise<void> {
  const canonicalId = await resolveDismissalPersonId(store, personId);
  if (!canonicalId) throw new Error(`Person ${personId} not found`);
  await store.run(
    `INSERT INTO discovery_dismissed (db_id, person_id, ai_reason, ai_tags, dismissed_at)
     VALUES (@dbId, @personId, @aiReason, @aiTags::jsonb, CURRENT_TIMESTAMP)
     ON CONFLICT (db_id, person_id) DO UPDATE SET
       ai_reason = EXCLUDED.ai_reason, ai_tags = EXCLUDED.ai_tags,
       dismissed_at = EXCLUDED.dismissed_at`,
    {
      dbId,
      personId: canonicalId,
      aiReason: aiReason || null,
      aiTags: aiTags ? JSON.stringify(aiTags) : null,
    },
  );
}

export const aiDiscoveryService = {
  /**
   * Start an AI discovery run for interesting ancestors in a database
   */
  async startDiscovery(
    dbId: string,
    options?: FullDiscoveryOptions,
  ): Promise<{ runId: string; message: string }> {
    const { batchSize, maxPersons } = normalizeFullDiscoveryOptions(options);
    const activeRun = activeDiscoveryRuns.get(dbId);
    if (activeRun) throw new DiscoveryRunConflictError(activeRun.runId);

    const runId = createDiscoveryRunId(dbId);
    const controller = new AbortController();
    activeDiscoveryRuns.set(dbId, { runId, controller });

    // Initialize progress tracking. Eviction never removes an active run,
    // because its background operation must retain both progress and its guard.
    evictOldestRun();
    discoveryRuns.set(runId, {
      status: 'pending',
      totalPersons: 0,
      analyzedPersons: 0,
      candidatesFound: 0,
      currentBatch: 0,
      totalBatches: 0,
    });

    // Run discovery asynchronously. Always release the scope guard, including
    // provider failures and cancellations, before a later request can start.
    void this.runDiscovery(runId, dbId, batchSize, maxPersons, controller.signal)
      .catch((err: Error) => {
        const progress = discoveryRuns.get(runId);
        if (!progress) return;
        if (controller.signal.aborted || err instanceof DiscoveryCancelledError) {
          progress.status = 'cancelled';
          logger.warn('ai-discovery', `Discovery ${runId} cancelled for dbId=${dbId}`);
          return;
        }
        progress.status = 'failed';
        progress.error = err.message;
        logger.error('ai-discovery', `Discovery ${runId} failed for dbId=${dbId}: ${err.message}`);
      })
      .finally(() => {
        if (activeDiscoveryRuns.get(dbId)?.runId === runId) {
          activeDiscoveryRuns.delete(dbId);
        }
      });

    return { runId, message: 'Discovery started' };
  },

  /**
   * Get progress of a discovery run
   */
  getProgress(runId: string): DiscoveryProgress | null {
    return discoveryRuns.get(runId) || null;
  },

  /** Request cancellation for the active full discovery in a database. */
  cancelDiscovery(dbId: string): { runId: string } | null {
    const activeRun = activeDiscoveryRuns.get(dbId);
    if (!activeRun) return null;

    logger.warn('ai-discovery', `Cancellation requested for discovery ${activeRun.runId} in dbId=${dbId}`);
    activeRun.controller.abort();
    return { runId: activeRun.runId };
  },

  getActiveDiscoveryRunId(dbId: string): string | null {
    return activeDiscoveryRuns.get(dbId)?.runId ?? null;
  },

  /**
   * Internal method to run discovery
   */
  async runDiscovery(
    runId: string,
    dbId: string,
    batchSize: number,
    maxPersons: number,
    signal?: AbortSignal,
  ): Promise<DiscoveryResult> {
    throwIfCancelled(signal);
    const progress = discoveryRuns.get(runId);
    if (!progress) throw new Error('Run not found');

    progress.status = 'running';

    // Get existing favorites to exclude
    const existingFavorites = await favoritesService.getFavoritesInDatabase(dbId);
    const existingFavoriteIds = new Set(existingFavorites.map(f => f.personId));

    // Get all persons in the database
    const db = await databaseService.getDatabase(dbId);
    const allPersonIds = Object.keys(db);

    // Filter out existing favorites and limit
    const personsToAnalyze = allPersonIds
      .filter(id => !existingFavoriteIds.has(id))
      .slice(0, maxPersons);

    progress.totalPersons = personsToAnalyze.length;
    progress.totalBatches = Math.ceil(personsToAnalyze.length / batchSize);

    const candidates: DiscoveryCandidate[] = [];

    // Process in batches
    for (let i = 0; i < personsToAnalyze.length; i += batchSize) {
      throwIfCancelled(signal);
      progress.currentBatch = Math.floor(i / batchSize) + 1;

      const batchIds = personsToAnalyze.slice(i, i + batchSize);
      const batchSummaries = batchIds.map(id => {
        const person = db[id];
        return buildPersonSummary(person, id);
      });

      const prompt = buildDiscoveryPrompt(batchSummaries, existingFavoriteIds);

      // Execute Claude CLI directly with piped input
      const output = await executeAiPrompt(prompt, 300000, signal);
      throwIfCancelled(signal);

      // Parse AI response
      const aiCandidates = parseAiResponse(output);

      // Build full candidate objects
      for (const candidate of aiCandidates) {
        const person = db[candidate.personId];
        if (!person) continue;

        // Get external ID for display
        const externalId = await idMappingService.getExternalId(candidate.personId, 'familysearch');

        candidates.push({
          personId: candidate.personId,
          externalId: externalId || undefined,
          name: person.name,
          lifespan: person.lifespan || '',
          birthPlace: person.birth?.place,
          deathPlace: person.death?.place,
          occupations: person.occupations,
          bio: person.bio,
          whyInteresting: candidate.whyInteresting,
          suggestedTags: candidate.suggestedTags,
          confidence: candidate.confidence,
        });
      }

      progress.analyzedPersons = Math.min(i + batchSize, personsToAnalyze.length);
      progress.candidatesFound = candidates.length;
    }

    progress.status = 'completed';

    const result: DiscoveryResult = {
      dbId,
      candidates,
      totalAnalyzed: progress.analyzedPersons,
      runId,
    };

    // Store results for later retrieval
    discoveryResults.set(runId, result);

    return result;
  },

  /**
   * Get results of a completed discovery run
   */
  async getResults(runId: string): Promise<DiscoveryResult | null> {
    const progress = discoveryRuns.get(runId);
    if (!progress || progress.status !== 'completed') {
      return null;
    }

    return discoveryResults.get(runId) || null;
  },

  /**
   * Apply discovery candidates as favorites
   */
  async applyCandidate(
    dbId: string,
    candidate: DiscoveryCandidate
  ): Promise<{ success: boolean }> {
    await favoritesService.setDbFavorite(
      dbId,
      candidate.personId,
      candidate.whyInteresting,
      candidate.suggestedTags
    );

    return { success: true };
  },

  /**
   * Quick discovery - analyze a sample of persons immediately and return results
   * This is a synchronous version for smaller datasets
   */
  async quickDiscovery(
    dbId: string,
    options?: {
      sampleSize?: number;
      excludeBiblical?: boolean;
      minBirthYear?: number;
      maxGenerations?: number;
      customPrompt?: string;
    }
  ): Promise<DiscoveryResult> {
    const sampleSize = options?.sampleSize ?? 100;
    const excludeBiblical = options?.excludeBiblical ?? false;
    const minBirthYear = options?.minBirthYear ?? (excludeBiblical ? 500 : undefined);
    const maxGenerations = options?.maxGenerations;
    const customPrompt = options?.customPrompt;
    logger.start('ai-discovery', `Quick discovery dbId=${dbId} sample=${sampleSize} excludeBiblical=${excludeBiblical} minBirthYear=${minBirthYear || 'none'} maxGenerations=${maxGenerations || 'none'} prompt=${customPrompt ? `"${customPrompt.slice(0, 50)}..."` : 'none'}`);

    // Get existing favorites and dismissed to exclude
    const existingFavorites = await favoritesService.getFavoritesInDatabase(dbId);
    const existingFavoriteIds = new Set(existingFavorites.map(f => f.personId));
    const postgresEnabled = await databaseService.isPostgresEnabled();
    const dismissedCandidates = postgresEnabled ? await this.getDismissedCandidates(dbId) : [];
    const dismissedIds = new Set(dismissedCandidates.map(d => d.personId));
    const excludeIds = new Set([...existingFavoriteIds, ...dismissedIds]);
    logger.data('ai-discovery', `Excluding ${existingFavoriteIds.size} existing favorites and ${dismissedIds.size} dismissed`);

    // Get persons with interesting attributes first (prioritize those with bios, occupations)
    let personsToAnalyze: Array<{ id: string; person: Person }> = [];

    // Helper to extract birth year from person data
    const getBirthYear = (person: Person): number | null => {
      if (!person.birth?.date && !person.lifespan) return null;
      const dateStr = person.birth?.date || person.lifespan?.split('-')[0] || '';
      const cleaned = dateStr.trim();
      if (cleaned.toUpperCase().includes('BC')) {
        const num = parseInt(cleaned.replace(/BC/i, ''));
        return isNaN(num) ? null : -num;
      }
      const num = parseInt(cleaned);
      return isNaN(num) ? null : num;
    };

    if (postgresEnabled) {
      const internalDbId = await databaseService.resolveDbId(dbId);
      // Use SQL to prioritize interesting persons
      const birthYearFilter = minBirthYear !== undefined
        ? `AND EXISTS (
             SELECT 1 FROM vital_event ve
             WHERE ve.person_id = p.person_id
             AND ve.event_type = 'birth'
             AND ve.date_year >= @minBirthYear
           )`
        : '';

      const generationFilter = maxGenerations !== undefined
        ? `AND dm.generation IS NOT NULL AND dm.generation <= @maxGenerations`
        : '';

      const rows = await postgresService.queryAll<{
        person_id: string;
        display_name: string;
        bio: string | null;
      }>(
        `SELECT p.person_id, p.display_name, p.bio
         FROM database_membership dm
         JOIN person p ON dm.person_id = p.person_id
         WHERE dm.db_id = @dbId
         ${birthYearFilter}
         ${generationFilter}
         ORDER BY
           CASE WHEN p.bio IS NOT NULL AND p.bio != '' THEN 0 ELSE 1 END,
           CASE WHEN EXISTS (SELECT 1 FROM claim c WHERE c.person_id = p.person_id
             AND c.predicate = 'occupation' AND c.value_text IS NOT NULL) THEN 0 ELSE 1 END,
           p.person_id
         LIMIT @limit`,
        { dbId: internalDbId, limit: sampleSize * 2, minBirthYear, maxGenerations } // Get extra to filter out favorites
      );

      const db = await databaseService.getDatabase(dbId);
      personsToAnalyze = rows
        .filter(r => !excludeIds.has(r.person_id))
        .slice(0, sampleSize)
        .map(r => ({ id: r.person_id, person: db[r.person_id] }))
        .filter(p => p.person);
    } else {
      // Fallback to loading all
      const db = await databaseService.getDatabase(dbId);
      personsToAnalyze = Object.entries(db)
        .filter(([id, person]) => {
          if (excludeIds.has(id)) return false;
          if (minBirthYear !== undefined) {
            const birthYear = getBirthYear(person);
            if (birthYear !== null && birthYear < minBirthYear) return false;
          }
          return true;
        })
        .slice(0, sampleSize)
        .map(([id, person]) => ({ id, person }));
    }

    if (personsToAnalyze.length === 0) {
      logger.skip('ai-discovery', `No persons to analyze (all may be favorites already)`);
      return {
        dbId,
        candidates: [],
        totalAnalyzed: 0,
        runId: `quick-${Date.now()}`,
      };
    }

    logger.data('ai-discovery', `Selected ${personsToAnalyze.length} persons to analyze`);

    // Build summaries
    const summaries = personsToAnalyze.map(({ id, person }) => buildPersonSummary(person, id));
    logger.data('ai-discovery', `Built ${summaries.length} person summaries for AI analysis`);

    const prompt = buildDiscoveryPrompt(summaries, existingFavoriteIds, customPrompt);

    // Execute prompt via configured AI provider toolkit
    logger.api('ai-discovery', `Sending prompt to AI provider via toolkit...`);
    const output = await executeAiPrompt(prompt, 300000);

    // Parse response
    logger.data('ai-discovery', `Parsing AI response...`);
    const aiCandidates = parseAiResponse(output);
    logger.ok('ai-discovery', `AI identified ${aiCandidates.length} interesting candidates`);
    const db = await databaseService.getDatabase(dbId);

    const candidates: DiscoveryCandidate[] = [];
    for (const candidate of aiCandidates) {
      const person = db[candidate.personId];
      if (!person) continue;

      const externalId = await idMappingService.getExternalId(candidate.personId, 'familysearch');

      candidates.push({
        personId: candidate.personId,
        externalId: externalId || undefined,
        name: person.name,
        lifespan: person.lifespan || '',
        birthPlace: person.birth?.place,
        deathPlace: person.death?.place,
        occupations: person.occupations,
        bio: person.bio,
        whyInteresting: candidate.whyInteresting,
        suggestedTags: candidate.suggestedTags,
        confidence: candidate.confidence,
      });
    }

    return {
      dbId,
      candidates,
      totalAnalyzed: personsToAnalyze.length,
      runId: `discovery-${Date.now()}`,
    };
  },

  /**
   * Dismiss a candidate (mark as not interesting)
   */
  async dismissCandidate(
    dbId: string,
    personId: string,
    aiReason?: string,
    aiTags?: string[]
  ): Promise<{ success: boolean }> {
    const internalDbId = await databaseService.resolveDbId(dbId);
    if (!internalDbId) throw new Error(`Database ${dbId} not found`);
    await writeDismissal(postgresService, internalDbId, personId, aiReason, aiTags);
    logger.done('ai-discovery', `Dismissed candidate personId=${personId}`);
    return { success: true };
  },

  /**
   * Dismiss multiple candidates atomically, including repeated person IDs.
   */
  async dismissCandidatesBatch(
    dbId: string,
    candidates: Array<{ personId: string; whyInteresting?: string; suggestedTags?: string[] }>
  ): Promise<{ dismissed: number }> {
    if (candidates.length === 0) return { dismissed: 0 };
    const internalDbId = await databaseService.resolveDbId(dbId);
    if (!internalDbId) throw new Error(`Database ${dbId} not found`);
    await postgresService.transaction(async tx => {
      for (const candidate of candidates) {
        await writeDismissal(tx, internalDbId, candidate.personId, candidate.whyInteresting, candidate.suggestedTags);
      }
    });
    return { dismissed: candidates.length };
  },

  /**
   * Get dismissed candidates for a database.
   */
  async getDismissedCandidates(dbId: string): Promise<Array<{
    personId: string;
    aiReason: string | null;
    aiTags: string[];
    dismissedAt: string;
  }>> {
    const internalDbId = await databaseService.resolveDbId(dbId);
    if (!internalDbId) return [];
    const rows = await postgresService.queryAll<{
      person_id: string;
      ai_reason: string | null;
      ai_tags: unknown;
      dismissed_at: Date | string;
    }>(
      `SELECT person_id, ai_reason, ai_tags, dismissed_at
       FROM discovery_dismissed
       WHERE db_id = @dbId
       ORDER BY dismissed_at DESC, person_id`,
      { dbId: internalDbId }
    );

    return rows.map(row => {
      const parsed = typeof row.ai_tags === 'string' ? safeJsonParse(row.ai_tags) : row.ai_tags;
      return {
        personId: row.person_id,
        aiReason: row.ai_reason,
        aiTags: Array.isArray(parsed) ? parsed.filter((t: unknown): t is string => typeof t === 'string') : [],
        dismissedAt: row.dismissed_at instanceof Date ? row.dismissed_at.toISOString() : row.dismissed_at,
      };
    });
  },

  /**
   * Get count of dismissed candidates.
   */
  async getDismissedCount(dbId: string): Promise<number> {
    const internalDbId = await databaseService.resolveDbId(dbId);
    if (!internalDbId) return 0;
    const result = await postgresService.queryOne<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM discovery_dismissed WHERE db_id = @dbId`,
      { dbId: internalDbId }
    );
    return Number(result?.count ?? 0);
  },

  /**
   * Undo dismiss (restore a candidate).
   */
  async undoDismiss(dbId: string, personId: string): Promise<{ success: boolean }> {
    const [internalDbId, canonicalId] = await Promise.all([
      databaseService.resolveDbId(dbId),
      resolveDismissalPersonId(postgresService, personId),
    ]);
    if (internalDbId && canonicalId) {
      await postgresService.run(
        `DELETE FROM discovery_dismissed WHERE db_id = @dbId AND person_id = @personId`,
        { dbId: internalDbId, personId: canonicalId }
      );
    }
    logger.done('ai-discovery', `Undid dismiss for personId=${personId}`);
    return { success: true };
  },

  /**
   * Clear all dismissed candidates for a database.
   */
  async clearDismissed(dbId: string): Promise<{ cleared: number }> {
    const internalDbId = await databaseService.resolveDbId(dbId);
    if (!internalDbId) return { cleared: 0 };
    const result = await postgresService.run(
      `DELETE FROM discovery_dismissed WHERE db_id = @dbId`,
      { dbId: internalDbId }
    );
    const count = result.rowCount ?? 0;
    logger.done('ai-discovery', `Cleared ${count} dismissed candidates for dbId=${dbId}`);
    return { cleared: count };
  },
};
