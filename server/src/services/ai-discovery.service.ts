import { spawn } from 'child_process';
import { databaseService } from './database.service.js';
import { favoritesService, PRESET_TAGS } from './favorites.service.js';
import { idMappingService } from './id-mapping.service.js';
import { sqliteService } from '../db/sqlite.service.js';
import type { Person } from '@fsf/shared';

/**
 * Execute Claude CLI with prompt piped to stdin
 */
async function executeClaudeCli(prompt: string, timeoutMs = 300000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', ['--print'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('Claude CLI timed out'));
    }, timeoutMs);

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`Claude CLI failed: ${stderr || 'Unknown error'}`));
      }
    });

    child.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    // Write prompt to stdin and close
    child.stdin.write(prompt);
    child.stdin.end();
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

// Store for tracking discovery runs
const discoveryRuns = new Map<string, DiscoveryProgress>();

function buildPersonSummary(person: Person & { canonicalId?: string }, personId: string): string {
  const parts: string[] = [];
  parts.push(person.name);
  if (person.lifespan) parts.push(person.lifespan);
  if (person.birth?.place) parts.push(`b:${person.birth.place}`);
  if (person.occupations?.length) parts.push(`occ:${person.occupations.slice(0, 3).join(',')}`);
  if (person.bio) parts.push(`bio:${person.bio.substring(0, 200)}...`);
  return `[${personId}] ${parts.join(' | ')}`;
}

function buildDiscoveryPrompt(personSummaries: string[], _existingFavoriteIds: Set<string>): string {
  return `Analyze these genealogical records and identify interesting ancestors. Return ONLY a JSON array.

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
  // Try to extract JSON from the response
  const jsonMatch = response.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];

  const parsed = JSON.parse(jsonMatch[0]);
  if (!Array.isArray(parsed)) return [];

  return parsed.filter(item =>
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
      const output = await executeClaudeCli(prompt, 300000);

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

    return {
      dbId,
      candidates,
      totalAnalyzed: progress.analyzedPersons,
      runId,
    };
  },

  /**
   * Get results of a completed discovery run
   */
  async getResults(runId: string): Promise<DiscoveryResult | null> {
    const progress = discoveryRuns.get(runId);
    if (!progress || progress.status !== 'completed') {
      return null;
    }

    // Results are stored in the progress tracking for now
    // In a production system, you'd want to persist these
    return null;
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
    }
  ): Promise<DiscoveryResult> {
    const sampleSize = options?.sampleSize ?? 100;

    // Get existing favorites to exclude
    const existingFavorites = await favoritesService.getFavoritesInDatabase(dbId);
    const existingFavoriteIds = new Set(existingFavorites.map(f => f.personId));

    // Get persons with interesting attributes first (prioritize those with bios, occupations)
    let personsToAnalyze: Array<{ id: string; person: Person }> = [];

    if (databaseService.isSqliteEnabled()) {
      // Use SQL to prioritize interesting persons
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
         ORDER BY
           CASE WHEN p.bio IS NOT NULL AND p.bio != '' THEN 0 ELSE 1 END,
           CASE WHEN c.value_text IS NOT NULL THEN 0 ELSE 1 END
         LIMIT @limit`,
        { dbId, limit: sampleSize * 2 } // Get extra to filter out favorites
      );

      const db = await databaseService.getDatabase(dbId);
      personsToAnalyze = rows
        .filter(r => !existingFavoriteIds.has(r.person_id))
        .slice(0, sampleSize)
        .map(r => ({ id: r.person_id, person: db[r.person_id] }))
        .filter(p => p.person);
    } else {
      // Fallback to loading all
      const db = await databaseService.getDatabase(dbId);
      personsToAnalyze = Object.entries(db)
        .filter(([id]) => !existingFavoriteIds.has(id))
        .slice(0, sampleSize)
        .map(([id, person]) => ({ id, person }));
    }

    if (personsToAnalyze.length === 0) {
      return {
        dbId,
        candidates: [],
        totalAnalyzed: 0,
        runId: `quick-${Date.now()}`,
      };
    }

    // Build summaries
    const summaries = personsToAnalyze.map(({ id, person }) => buildPersonSummary(person, id));

    const prompt = buildDiscoveryPrompt(summaries, existingFavoriteIds);

    // Execute Claude CLI directly with piped input
    const output = await executeClaudeCli(prompt, 300000);

    // Parse response
    const aiCandidates = parseAiResponse(output);
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
};
