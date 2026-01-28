import type { IndexerStatus, IndexOptions, IndexerProgress } from '@fsf/shared';
import { sseManager } from '../utils/sseManager.js';
import { browserService } from './browser.service.js';
import { logger } from '../lib/logger.js';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';

const PROJECT_ROOT = path.resolve(import.meta.dirname, '../../../');

let currentStatus: IndexerStatus = {
  jobId: null,
  status: 'idle'
};

let currentProcess: ChildProcess | null = null;

export const indexerService = {
  getStatus(): IndexerStatus {
    return currentStatus;
  },

  async startIndexing(options: IndexOptions): Promise<IndexerStatus> {
    if (currentStatus.status === 'running') {
      throw new Error('Indexer is already running');
    }

    const jobId = `job-${Date.now()}`;
    const progress: IndexerProgress = {
      new: 0,
      cached: 0,
      refreshed: 0,
      generations: 0,
      deepest: '',
      currentPerson: undefined as string | undefined
    };

    currentStatus = {
      jobId,
      status: 'running',
      rootId: options.rootId,
      startedAt: new Date().toISOString(),
      progress
    };

    sseManager.broadcast('started', {
      type: 'started',
      timestamp: new Date().toISOString(),
      data: { jobId, rootId: options.rootId, options }
    });

    // Run indexing in background
    this.runIndexing(options, jobId, progress).catch(err => {
      logger.error('indexer', `Error during indexing: ${err.message}`);
      currentStatus = {
        ...currentStatus,
        status: 'error',
        error: err.message
      };
      sseManager.broadcast('error', {
        type: 'error',
        timestamp: new Date().toISOString(),
        data: { jobId, message: err.message }
      });
    });

    return currentStatus;
  },

  async runIndexing(options: IndexOptions, jobId: string, progress: IndexerProgress): Promise<void> {
    const { rootId, maxGenerations, ignoreIds = [], cacheMode = 'all', oldest } = options;

    logger.start('indexer', `Starting indexing for ${rootId}`);
    logger.data('indexer', `Options: maxGen=${maxGenerations || 'unlimited'} cacheMode=${cacheMode} oldest=${oldest || 'none'} ignoreIds=${ignoreIds.length}`);

    // Get FamilySearch token from browser session
    if (!browserService.isConnected()) {
      logger.browser('indexer', `Connecting to browser...`);
      await browserService.connect();
    }

    const { token } = await browserService.getFamilySearchToken();
    if (!token) {
      throw new Error('No FamilySearch token found. Please log in via the browser.');
    }

    logger.auth('indexer', `Got FamilySearch token, spawning CLI...`);

    // Build CLI arguments
    const args: string[] = ['tsx', 'scripts/index.ts', rootId];

    if (maxGenerations !== undefined && maxGenerations !== null) {
      args.push(`--max=${maxGenerations}`);
    }

    if (cacheMode && cacheMode !== 'all') {
      args.push(`--cache=${cacheMode}`);
    }

    if (ignoreIds.length > 0) {
      args.push(`--ignore=${ignoreIds.join(',')}`);
    }

    if (oldest) {
      args.push(`--oldest=${oldest}`);
    }

    logger.start('indexer', `Running: npx ${args.join(' ')}`);

    // Validate CLI executable exists before spawning
    const cliPath = path.join(PROJECT_ROOT, 'scripts/index.ts');
    if (!fs.existsSync(cliPath)) {
      throw new Error(`CLI not found at ${cliPath}. Please ensure the project is properly set up.`);
    }

    // Spawn the CLI process with the token
    currentProcess = spawn('npx', args, {
      cwd: PROJECT_ROOT,
      env: {
        ...process.env,
        FS_ACCESS_TOKEN: token
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    // Parse CLI output to update progress
    currentProcess.stdout?.on('data', (data: Buffer) => {
      const lines = data.toString().split('\n').filter(l => l.trim());

      for (const line of lines) {
        logger.data('cli', line);

        // Parse progress from CLI output
        // Format: "icon GGG ID (PARENT+PARENT) LIFESPAN NAME, LOCATION [OCCUPATION]"
        // Where GGG is generation number like 000, 001, etc.
        // Use \S+ for emoji since emojis are multi-codepoint
        const genMatch = line.match(/^\S+\s+(\d{3})\s+/);
        const idMatch = line.match(/\d{3}\s+([A-Z0-9]{4}-[A-Z0-9]{2,4})\s/);

        if (genMatch) {
          const gen = parseInt(genMatch[1], 10);
          if (gen > progress.generations) {
            progress.generations = gen;
          }
        }

        if (idMatch) {
          progress.currentPerson = idMatch[1];
        }

        // Parse icon for status counting
        if (line.includes('✅')) progress.new++;
        else if (line.includes('🔄')) progress.refreshed++;
        else if (line.includes('💾')) progress.cached++;

        // Parse deepest ancestor from name
        const nameMatch = line.match(/[A-Z0-9]{4}-[A-Z0-9]{2,4}\s+([^-]+)/);
        if (nameMatch && genMatch) {
          const gen = parseInt(genMatch[1], 10);
          if (gen >= progress.generations) {
            progress.deepest = nameMatch[1].trim().split(' - ')[0];
          }
        }

        // Broadcast CLI output line for real-time display
        sseManager.broadcast('output', {
          type: 'output',
          timestamp: new Date().toISOString(),
          data: { jobId, line }
        });

        // Broadcast progress update
        sseManager.broadcast('progress', {
          type: 'progress',
          timestamp: new Date().toISOString(),
          data: { jobId, progress: { ...progress } }
        });
      }
    });

    currentProcess.stderr?.on('data', (data: Buffer) => {
      logger.error('cli', data.toString().trim());
    });

    // Wait for process to complete
    await new Promise<void>((resolve, reject) => {
      currentProcess!.on('close', (code) => {
        logger.done('indexer', `CLI process exited with code ${code}`);
        currentProcess = null;

        if (code === 0) {
          currentStatus = {
            ...currentStatus,
            status: 'completed',
            progress
          };
          sseManager.broadcast('completed', {
            type: 'completed',
            timestamp: new Date().toISOString(),
            data: {
              jobId,
              progress,
              message: `Indexed ${progress.new + progress.cached + progress.refreshed} ancestors over ${progress.generations} generations`
            }
          });
          resolve();
        } else if (code === null) {
          // Process was killed (stopped by user)
          currentStatus = {
            jobId: null,
            status: 'idle',
            progress
          };
          sseManager.broadcast('stopped', {
            type: 'stopped',
            timestamp: new Date().toISOString(),
            data: { jobId, progress }
          });
          resolve();
        } else {
          currentStatus = {
            ...currentStatus,
            status: 'error',
            error: `CLI exited with code ${code}`
          };
          reject(new Error(`CLI exited with code ${code}`));
        }
      });

      currentProcess!.on('error', (err) => {
        logger.error('indexer', `Failed to spawn CLI: ${err.message}`);
        currentProcess = null;
        reject(err);
      });
    });

    progress.currentPerson = undefined;
  },

  async stopIndexing(): Promise<void> {
    if (currentStatus.status !== 'running') {
      throw new Error('No indexing job is running');
    }

    logger.warn('indexer', `Stop requested`);

    if (currentProcess) {
      // Send SIGINT to allow graceful shutdown (CLI handles SIGINT to save progress)
      currentProcess.kill('SIGINT');
      currentStatus.status = 'stopping';
    }
  }
};
