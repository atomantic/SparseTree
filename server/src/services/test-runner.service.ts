import { spawn, ChildProcess } from 'child_process';
import { Response } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../../..');

type TestType = 'unit' | 'e2e' | 'feature-coverage' | 'code-coverage';

interface TestRun {
  id: string;
  type: TestType;
  status: 'running' | 'completed' | 'failed' | 'stopped';
  startTime: Date;
  endTime?: Date;
  exitCode?: number;
}

interface SSEClient {
  id: string;
  response: Response;
}

// SSE clients for test events
const clients: SSEClient[] = [];

// Current test run state
let currentRun: TestRun | null = null;
let currentProcess: ChildProcess | null = null;

function broadcast(event: string, data: object) {
  const message = `event: ${event}\ndata: ${JSON.stringify({ data })}\n\n`;
  for (const { response } of clients) {
    response.write(message);
  }
}

function getTestCommand(type: TestType): { command: string; args: string[] } {
  switch (type) {
    case 'unit':
      return { command: 'npm', args: ['run', 'test:ci'] };
    case 'e2e':
      return { command: 'npx', args: ['playwright', 'test', 'tests/e2e'] };
    case 'feature-coverage':
      return { command: 'npx', args: ['tsx', 'scripts/generate-feature-coverage-report.ts'] };
    case 'code-coverage':
      return { command: 'npm', args: ['run', 'test:coverage'] };
    default:
      throw new Error(`Unknown test type: ${type}`);
  }
}

export const testRunnerService = {
  addClient(response: Response): string {
    const id = crypto.randomUUID();
    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    response.write(`data: ${JSON.stringify({ type: 'connected', clientId: id })}\n\n`);
    clients.push({ id, response });

    // Send current status immediately
    if (currentRun) {
      response.write(`event: status\ndata: ${JSON.stringify({ data: currentRun })}\n\n`);
    }

    return id;
  },

  removeClient(id: string) {
    const index = clients.findIndex(c => c.id === id);
    if (index !== -1) clients.splice(index, 1);
  },

  getStatus(): TestRun | null {
    return currentRun;
  },

  async runTests(type: TestType): Promise<TestRun> {
    if (currentRun?.status === 'running') {
      throw new Error('A test run is already in progress');
    }

    const runId = `test-${type}-${Date.now()}`;
    currentRun = {
      id: runId,
      type,
      status: 'running',
      startTime: new Date(),
    };

    broadcast('started', currentRun);

    const { command, args } = getTestCommand(type);

    return new Promise((resolve) => {
      currentProcess = spawn(command, args, {
        cwd: PROJECT_ROOT,
        shell: true,
        env: {
          ...process.env,
          FORCE_COLOR: '1', // Enable colored output
        },
      });

      currentProcess.stdout?.on('data', (data: Buffer) => {
        const lines = data.toString().split('\n');
        for (const line of lines) {
          if (line.trim()) {
            broadcast('output', { line });
          }
        }
      });

      currentProcess.stderr?.on('data', (data: Buffer) => {
        const lines = data.toString().split('\n');
        for (const line of lines) {
          if (line.trim()) {
            broadcast('output', { line });
          }
        }
      });

      currentProcess.on('close', (code) => {
        if (currentRun && currentRun.status !== 'stopped') {
          currentRun.status = code === 0 ? 'completed' : 'failed';
          currentRun.endTime = new Date();
          currentRun.exitCode = code ?? undefined;
          broadcast('completed', currentRun);
        }
        resolve(currentRun!);
        currentProcess = null;
      });

      currentProcess.on('error', (err) => {
        if (currentRun && currentRun.status !== 'stopped') {
          currentRun.status = 'failed';
          currentRun.endTime = new Date();
          broadcast('error', { message: err.message });
          broadcast('completed', currentRun);
        }
        resolve(currentRun!);
        currentProcess = null;
      });
    });
  },

  stopTests(): boolean {
    if (!currentProcess || !currentRun) {
      return false;
    }

    currentProcess.kill('SIGTERM');

    if (currentRun) {
      currentRun.status = 'stopped';
      currentRun.endTime = new Date();
      broadcast('stopped', currentRun);
    }

    currentProcess = null;
    return true;
  },

  checkReportExists(reportPath: string): boolean {
    const fullPath = path.join(PROJECT_ROOT, 'client/public', reportPath, 'index.html');
    return fs.existsSync(fullPath);
  },

  getReportStatus(): { e2e: boolean; featureCoverage: boolean; codeCoverage: boolean } {
    return {
      e2e: this.checkReportExists('playwright-report'),
      featureCoverage: this.checkReportExists('coverage-report'),
      codeCoverage: this.checkReportExists('code-coverage'),
    };
  },
};
