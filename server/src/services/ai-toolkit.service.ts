import path from 'path';
import { fileURLToPath } from 'url';
import { createAIToolkit, type AIToolkit } from 'portos-ai-toolkit/server';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '../../../data/ai');

// Singleton instance of the AI toolkit
let toolkit: AIToolkit | null = null;

export function getAIToolkit(): AIToolkit {
  if (!toolkit) {
    throw new Error('AI Toolkit not initialized. Call initAIToolkit first.');
  }
  return toolkit;
}

export function initAIToolkit(io: unknown): AIToolkit {
  toolkit = createAIToolkit({
    dataDir: DATA_DIR,
    io
  });
  return toolkit;
}

export const aiToolkitService = {
  getToolkit: getAIToolkit,
  initToolkit: initAIToolkit,
};
