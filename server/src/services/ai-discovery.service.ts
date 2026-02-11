import { databaseService } from './database.service.js';
import { favoritesService, PRESET_TAGS } from './favorites.service.js';
import { idMappingService } from './id-mapping.service.js';
import { sqliteService } from '../db/sqlite.service.js';
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
async function executeAiPrompt(prompt: string, timeoutMs = 300000): Promise<string> {
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

  return new Promise((resolve, reject) => {
    let output = '';

    const onData = (text: string) => {
      output += text;
    };

    const onComplete = (metadata: { success: boolean; error?: string; errorDetails?: string; duration?: number }) => {
      const elapsed = Date.now() - startTime;
      if (metadata.success) {
        logger.done('ai-discovery', `${activeProvider.name} completed in ${elapsed}ms, response: ${output.length} chars`);
        resolve(output);
      } else {
        const errorMsg = metadata.errorDetails || metadata.error || 'Unknown error';
        logger.error('ai-discovery', `${activeProvider.name} failed after ${elapsed}ms: ${metadata.error || 'Unknown error'}`);
        if (metadata.errorDetails) {
          logger.error('ai-discovery', `Error details: ${metadata.errorDetails}`);
        }
        reject(new Error(`AI run failed: ${errorMsg}`));
      }
    };

    if (provider.type === 'cli') {
      runner.executeCliRun(runId, provider, prompt, process.cwd(), onData, onComplete, timeout || timeoutMs);
    } else {
      runner.executeApiRun(runId, provider, provider.defaultModel, prompt, process.cwd(), null, onData, onComplete);
    }
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
  status: 'pending' | 'running' | 'completed' | 'failed';
  totalPersons: number;
  analyzedPersons: number;
  candidatesFound: number;
  currentBatch: number;
  totalBatches: number;
  error?: string;
}

// Store for tracking discovery runs and their results
const discoveryRuns = new Map<string, DiscoveryProgress>();
const discoveryResults = new Map<string, DiscoveryResult>();

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
  // Look for the last JSON array containing real personIds (starting with 01KF)
  // This avoids matching example JSON from the prompt
  const realJsonStart = response.lastIndexOf('[{"personId":"01KF');
  if (realJsonStart === -1) {
    // Try alternate format with whitespace
    const altStart = response.lastIndexOf('[\n  {"personId":"01KF');
    if (altStart === -1) return [];
    return parseJsonFromPosition(response, altStart);
  }
  return parseJsonFromPosition(response, realJsonStart);
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

export const aiDiscoveryService = {
  /**
   * Start an AI discovery run for interesting ancestors in a database
   */
  async startDiscovery(
    dbId: string,
    options?: {
      batchSize?: number;
      maxPersons?: number;
      model?: string;
    }
  ): Promise<{ runId: string; message: string }> {
    const runId = `discovery-${dbId}-${Date.now()}`;
    const batchSize = options?.batchSize ?? 50;
    const maxPersons = options?.maxPersons ?? 500;

    // Initialize progress tracking
    discoveryRuns.set(runId, {
      status: 'pending',
      totalPersons: 0,
      analyzedPersons: 0,
      candidatesFound: 0,
      currentBatch: 0,
      totalBatches: 0,
    });

    // Run discovery asynchronously
    this.runDiscovery(runId, dbId, batchSize, maxPersons, options?.model).catch(err => {
      const progress = discoveryRuns.get(runId);
      if (progress) {
        progress.status = 'failed';
        progress.error = err.message;
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

  /**
   * Internal method to run discovery
   */
  async runDiscovery(
    runId: string,
    dbId: string,
    batchSize: number,
    maxPersons: number,
    _model?: string
  ): Promise<DiscoveryResult> {
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
      progress.currentBatch = Math.floor(i / batchSize) + 1;

      const batchIds = personsToAnalyze.slice(i, i + batchSize);
      const batchSummaries = batchIds.map(id => {
        const person = db[id];
        return buildPersonSummary(person, id);
      });

      const prompt = buildDiscoveryPrompt(batchSummaries, existingFavoriteIds);

      // Execute Claude CLI directly with piped input
      const output = await executeAiPrompt(prompt, 300000);

      // Parse AI response
      const aiCandidates = parseAiResponse(output);

      // Build full candidate objects
      for (const candidate of aiCandidates) {
        const person = db[candidate.personId];
        if (!person) continue;

        // Get external ID for display
        const externalId = idMappingService.getExternalId(candidate.personId, 'familysearch');

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
    favoritesService.setDbFavorite(
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
      model?: string;
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
    const dismissedCandidates = this.getDismissedCandidates(dbId);
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

    if (databaseService.isSqliteEnabled()) {
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

      const rows = sqliteService.queryAll<{
        person_id: string;
        display_name: string;
        bio: string | null;
      }>(
        `SELECT DISTINCT p.person_id, p.display_name, p.bio
         FROM database_membership dm
         JOIN person p ON dm.person_id = p.person_id
         LEFT JOIN claim c ON p.person_id = c.person_id AND c.predicate = 'occupation'
         WHERE dm.db_id = @dbId
         ${birthYearFilter}
         ${generationFilter}
         ORDER BY
           CASE WHEN p.bio IS NOT NULL AND p.bio != '' THEN 0 ELSE 1 END,
           CASE WHEN c.value_text IS NOT NULL THEN 0 ELSE 1 END
         LIMIT @limit`,
        { dbId, limit: sampleSize * 2, minBirthYear, maxGenerations } // Get extra to filter out favorites
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

    // Execute Claude CLI directly with piped input
    logger.api('ai-discovery', `Sending prompt to Claude CLI...`);
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

      const externalId = idMappingService.getExternalId(candidate.personId, 'familysearch');

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
  dismissCandidate(
    dbId: string,
    personId: string,
    aiReason?: string,
    aiTags?: string[]
  ): { success: boolean } {
    sqliteService.run(
      `INSERT OR REPLACE INTO discovery_dismissed (db_id, person_id, ai_reason, ai_tags, dismissed_at)
       VALUES (@dbId, @personId, @aiReason, @aiTags, datetime('now'))`,
      {
        dbId,
        personId,
        aiReason: aiReason || null,
        aiTags: aiTags ? JSON.stringify(aiTags) : null,
      }
    );
    logger.done('ai-discovery', `Dismissed candidate personId=${personId}`);
    return { success: true };
  },

  /**
   * Dismiss multiple candidates at once
   */
  dismissCandidatesBatch(
    dbId: string,
    candidates: Array<{ personId: string; whyInteresting?: string; suggestedTags?: string[] }>
  ): { dismissed: number } {
    let dismissed = 0;
    for (const candidate of candidates) {
      this.dismissCandidate(dbId, candidate.personId, candidate.whyInteresting, candidate.suggestedTags);
      dismissed++;
    }
    return { dismissed };
  },

  /**
   * Get dismissed candidates for a database
   */
  getDismissedCandidates(dbId: string): Array<{
    personId: string;
    aiReason: string | null;
    aiTags: string[];
    dismissedAt: string;
  }> {
    const rows = sqliteService.queryAll<{
      person_id: string;
      ai_reason: string | null;
      ai_tags: string | null;
      dismissed_at: string;
    }>(
      `SELECT person_id, ai_reason, ai_tags, dismissed_at
       FROM discovery_dismissed
       WHERE db_id = @dbId
       ORDER BY dismissed_at DESC`,
      { dbId }
    );

    return rows.map(row => ({
      personId: row.person_id,
      aiReason: row.ai_reason,
      aiTags: row.ai_tags ? JSON.parse(row.ai_tags) : [],
      dismissedAt: row.dismissed_at,
    }));
  },

  /**
   * Get count of dismissed candidates
   */
  getDismissedCount(dbId: string): number {
    const result = sqliteService.queryOne<{ count: number }>(
      `SELECT COUNT(*) as count FROM discovery_dismissed WHERE db_id = @dbId`,
      { dbId }
    );
    return result?.count || 0;
  },

  /**
   * Undo dismiss (restore a candidate)
   */
  undoDismiss(dbId: string, personId: string): { success: boolean } {
    sqliteService.run(
      `DELETE FROM discovery_dismissed WHERE db_id = @dbId AND person_id = @personId`,
      { dbId, personId }
    );
    logger.done('ai-discovery', `Undid dismiss for personId=${personId}`);
    return { success: true };
  },

  /**
   * Clear all dismissed candidates for a database
   */
  clearDismissed(dbId: string): { cleared: number } {
    const count = this.getDismissedCount(dbId);
    sqliteService.run(
      `DELETE FROM discovery_dismissed WHERE db_id = @dbId`,
      { dbId }
    );
    logger.done('ai-discovery', `Cleared ${count} dismissed candidates for dbId=${dbId}`);
    return { cleared: count };
  },
};
