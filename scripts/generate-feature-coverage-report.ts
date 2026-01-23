#!/usr/bin/env npx tsx
/**
 * Generate BDD Feature Coverage Report
 * Creates an HTML report showing feature test coverage
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { FEATURES, FEATURE_CATEGORIES, getCoverageStats, type Feature, type FeatureCategory } from '../tests/coverage-matrix.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUTPUT_DIR = path.resolve(__dirname, '../client/public/coverage-report');

function getStatusColor(percentage: number): string {
  if (percentage >= 80) return '#22c55e'; // green
  if (percentage >= 60) return '#eab308'; // yellow
  if (percentage >= 40) return '#f97316'; // orange
  return '#ef4444'; // red
}

function getPriorityBadge(priority: string): string {
  const colors: Record<string, string> = {
    critical: 'bg-red-500',
    high: 'bg-orange-500',
    medium: 'bg-yellow-500',
    low: 'bg-gray-500',
  };
  return `<span class="px-2 py-0.5 text-xs text-white rounded ${colors[priority]}">${priority}</span>`;
}

function generateHTML(): string {
  const stats = getCoverageStats();
  const timestamp = new Date().toISOString();

  const featuresByCategory: Record<FeatureCategory, Feature[]> = {} as Record<FeatureCategory, Feature[]>;
  for (const feature of FEATURES) {
    if (!featuresByCategory[feature.category]) {
      featuresByCategory[feature.category] = [];
    }
    featuresByCategory[feature.category].push(feature);
  }

  const untestedCritical = FEATURES.filter(f => !f.tested && f.priority === 'critical');
  const untestedHigh = FEATURES.filter(f => !f.tested && f.priority === 'high');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SparseTree Feature Coverage Report</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    body { background-color: #1a1a2e; color: #eaeaea; }
    .card { background-color: #16213e; border: 1px solid #0f3460; }
    .tested { color: #22c55e; }
    .untested { color: #ef4444; }
    .progress-bar { background-color: #0f3460; }
  </style>
</head>
<body class="min-h-screen p-8">
  <div class="max-w-6xl mx-auto">
    <header class="mb-8">
      <h1 class="text-3xl font-bold mb-2">SparseTree Feature Coverage Report</h1>
      <p class="text-gray-400">Generated: ${timestamp}</p>
    </header>

    <!-- Overall Stats -->
    <div class="card rounded-lg p-6 mb-8">
      <h2 class="text-xl font-semibold mb-4">Overall Coverage</h2>
      <div class="flex items-center gap-8">
        <div class="text-center">
          <div class="text-5xl font-bold" style="color: ${getStatusColor(stats.percentage)}">${stats.percentage}%</div>
          <div class="text-gray-400 mt-1">${stats.tested} / ${stats.total} features</div>
        </div>
        <div class="flex-1">
          <div class="progress-bar rounded-full h-4 overflow-hidden">
            <div class="h-full transition-all" style="width: ${stats.percentage}%; background-color: ${getStatusColor(stats.percentage)}"></div>
          </div>
        </div>
      </div>
    </div>

    <!-- Priority Breakdown -->
    <div class="card rounded-lg p-6 mb-8">
      <h2 class="text-xl font-semibold mb-4">Coverage by Priority</h2>
      <div class="grid grid-cols-4 gap-4">
        ${(['critical', 'high', 'medium', 'low'] as const).map(priority => {
          const pStats = stats.byPriority[priority];
          const pct = pStats.total > 0 ? Math.round((pStats.tested / pStats.total) * 100) : 0;
          return `
            <div class="text-center p-4 rounded-lg" style="background-color: #0f3460">
              ${getPriorityBadge(priority)}
              <div class="text-2xl font-bold mt-2" style="color: ${getStatusColor(pct)}">${pct}%</div>
              <div class="text-sm text-gray-400">${pStats.tested}/${pStats.total}</div>
            </div>
          `;
        }).join('')}
      </div>
    </div>

    ${(untestedCritical.length > 0 || untestedHigh.length > 0) ? `
    <!-- Untested Critical/High Features Alert -->
    <div class="bg-red-900/30 border border-red-500/50 rounded-lg p-6 mb-8">
      <h2 class="text-xl font-semibold mb-4 text-red-400">Attention: Untested High-Priority Features</h2>
      ${untestedCritical.length > 0 ? `
        <div class="mb-4">
          <h3 class="font-medium text-red-300 mb-2">Critical (${untestedCritical.length})</h3>
          <ul class="list-disc list-inside text-gray-300">
            ${untestedCritical.map(f => `<li>${f.name} - ${f.description}</li>`).join('')}
          </ul>
        </div>
      ` : ''}
      ${untestedHigh.length > 0 ? `
        <div>
          <h3 class="font-medium text-orange-300 mb-2">High (${untestedHigh.length})</h3>
          <ul class="list-disc list-inside text-gray-300">
            ${untestedHigh.map(f => `<li>${f.name} - ${f.description}</li>`).join('')}
          </ul>
        </div>
      ` : ''}
    </div>
    ` : ''}

    <!-- Features by Category -->
    <div class="space-y-6">
      <h2 class="text-xl font-semibold">Features by Category</h2>
      ${Object.entries(featuresByCategory).map(([category, features]) => {
        const catStats = stats.byCategory[category];
        const catPct = catStats.total > 0 ? Math.round((catStats.tested / catStats.total) * 100) : 0;
        return `
          <div class="card rounded-lg overflow-hidden">
            <div class="p-4 flex items-center justify-between" style="background-color: #0f3460">
              <h3 class="font-semibold">${FEATURE_CATEGORIES[category as FeatureCategory]}</h3>
              <div class="flex items-center gap-3">
                <span class="text-sm text-gray-400">${catStats.tested}/${catStats.total}</span>
                <span class="font-bold" style="color: ${getStatusColor(catPct)}">${catPct}%</span>
              </div>
            </div>
            <div class="divide-y divide-gray-700">
              ${features.map(f => `
                <div class="p-4 flex items-center gap-4">
                  <span class="w-6 text-center ${f.tested ? 'tested' : 'untested'}">
                    ${f.tested ? '✓' : '✗'}
                  </span>
                  <div class="flex-1">
                    <div class="flex items-center gap-2">
                      <span class="font-medium">${f.name}</span>
                      ${getPriorityBadge(f.priority)}
                    </div>
                    <p class="text-sm text-gray-400">${f.description}</p>
                    ${f.specFile ? `<p class="text-xs text-blue-400 mt-1">${f.specFile}</p>` : ''}
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        `;
      }).join('')}
    </div>

    <footer class="mt-8 text-center text-gray-500 text-sm">
      <p>SparseTree Coverage Report • <a href="/" class="text-blue-400 hover:underline">Back to App</a></p>
    </footer>
  </div>
</body>
</html>`;
}

async function main() {
  console.log('Generating feature coverage report...');

  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // Generate HTML
  const html = generateHTML();
  const outputPath = path.join(OUTPUT_DIR, 'index.html');
  fs.writeFileSync(outputPath, html);

  // Print summary
  const stats = getCoverageStats();
  console.log('\n📊 Feature Coverage Summary:');
  console.log(`   Total Features: ${stats.total}`);
  console.log(`   Tested: ${stats.tested} (${stats.percentage}%)`);
  console.log(`   Untested: ${stats.untested}`);
  console.log('\n   By Priority:');
  for (const [priority, pStats] of Object.entries(stats.byPriority)) {
    const pct = pStats.total > 0 ? Math.round((pStats.tested / pStats.total) * 100) : 0;
    console.log(`     ${priority}: ${pStats.tested}/${pStats.total} (${pct}%)`);
  }
  console.log(`\n✅ Report generated: ${outputPath}`);
}

main();
