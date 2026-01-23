#!/usr/bin/env npx tsx
/**
 * Generate Code Coverage Report Dashboard
 * Creates an HTML dashboard linking to coverage reports
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUTPUT_DIR = path.resolve(__dirname, '../client/public/code-coverage');

interface CoverageSummary {
  total: number;
  covered: number;
  skipped: number;
  pct: number;
}

interface CoverageData {
  lines: CoverageSummary;
  statements: CoverageSummary;
  functions: CoverageSummary;
  branches: CoverageSummary;
}

interface FileCoverage {
  path: string;
  lines: CoverageSummary;
  statements: CoverageSummary;
  functions: CoverageSummary;
  branches: CoverageSummary;
}

function getStatusColor(percentage: number): string {
  if (percentage >= 80) return '#22c55e';
  if (percentage >= 60) return '#eab308';
  if (percentage >= 40) return '#f97316';
  return '#ef4444';
}

function loadCoverageSummary(): { total: CoverageData; files: FileCoverage[] } | null {
  const summaryPath = path.join(OUTPUT_DIR, 'coverage-summary.json');
  if (!fs.existsSync(summaryPath)) {
    return null;
  }

  const data = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'));
  const total = data.total as CoverageData;

  const files: FileCoverage[] = [];
  for (const [filePath, coverage] of Object.entries(data)) {
    if (filePath === 'total') continue;
    files.push({
      path: filePath,
      ...(coverage as CoverageData),
    });
  }

  // Sort by line coverage (ascending, so low coverage files appear first)
  files.sort((a, b) => a.lines.pct - b.lines.pct);

  return { total, files };
}

function generateHTML(): string {
  const timestamp = new Date().toISOString();
  const coverage = loadCoverageSummary();

  if (!coverage) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SparseTree Code Coverage</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    body { background-color: #1a1a2e; color: #eaeaea; }
    .card { background-color: #16213e; border: 1px solid #0f3460; }
  </style>
</head>
<body class="min-h-screen p-8">
  <div class="max-w-4xl mx-auto">
    <header class="mb-8">
      <h1 class="text-3xl font-bold mb-2">SparseTree Code Coverage</h1>
      <p class="text-gray-400">Generated: ${timestamp}</p>
    </header>

    <div class="card rounded-lg p-6">
      <h2 class="text-xl font-semibold mb-4 text-yellow-400">No Coverage Data Found</h2>
      <p class="text-gray-300 mb-4">Run the test suite with coverage to generate reports:</p>
      <pre class="bg-gray-800 p-4 rounded text-sm overflow-x-auto">npm run test:coverage</pre>
      <p class="text-gray-400 mt-4 text-sm">This will generate coverage data in this directory.</p>
    </div>

    <footer class="mt-8 text-center text-gray-500 text-sm">
      <p>SparseTree Coverage Report • <a href="/" class="text-blue-400 hover:underline">Back to App</a></p>
    </footer>
  </div>
</body>
</html>`;
  }

  const { total, files } = coverage;
  const lowCoverageFiles = files.filter(f => f.lines.pct < 50);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SparseTree Code Coverage</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    body { background-color: #1a1a2e; color: #eaeaea; }
    .card { background-color: #16213e; border: 1px solid #0f3460; }
    .progress-bar { background-color: #0f3460; }
  </style>
</head>
<body class="min-h-screen p-8">
  <div class="max-w-6xl mx-auto">
    <header class="mb-8">
      <h1 class="text-3xl font-bold mb-2">SparseTree Code Coverage</h1>
      <p class="text-gray-400">Generated: ${timestamp}</p>
    </header>

    <!-- Overall Stats -->
    <div class="card rounded-lg p-6 mb-8">
      <h2 class="text-xl font-semibold mb-4">Overall Coverage</h2>
      <div class="grid grid-cols-4 gap-6">
        ${(['lines', 'statements', 'functions', 'branches'] as const).map(metric => {
          const stat = total[metric];
          return `
            <div class="text-center">
              <div class="text-3xl font-bold" style="color: ${getStatusColor(stat.pct)}">${stat.pct.toFixed(1)}%</div>
              <div class="text-gray-400 text-sm">${metric}</div>
              <div class="text-gray-500 text-xs">${stat.covered}/${stat.total}</div>
            </div>
          `;
        }).join('')}
      </div>
      <div class="mt-6">
        <div class="flex items-center gap-4 text-sm text-gray-400 mb-2">
          <span>Line Coverage</span>
          <span class="ml-auto">${total.lines.pct.toFixed(1)}%</span>
        </div>
        <div class="progress-bar rounded-full h-3 overflow-hidden">
          <div class="h-full transition-all" style="width: ${total.lines.pct}%; background-color: ${getStatusColor(total.lines.pct)}"></div>
        </div>
      </div>
    </div>

    <!-- Detailed HTML Report Link -->
    <div class="card rounded-lg p-6 mb-8">
      <h2 class="text-xl font-semibold mb-4">Detailed Reports</h2>
      <p class="text-gray-400 mb-4">Click below to open the detailed Istanbul coverage report:</p>
      <a href="./index.html" class="inline-block px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition">
        Open Detailed HTML Report
      </a>
    </div>

    ${lowCoverageFiles.length > 0 ? `
    <!-- Low Coverage Files Alert -->
    <div class="bg-red-900/30 border border-red-500/50 rounded-lg p-6 mb-8">
      <h2 class="text-xl font-semibold mb-4 text-red-400">Low Coverage Files (&lt;50%)</h2>
      <div class="space-y-2">
        ${lowCoverageFiles.slice(0, 10).map(f => `
          <div class="flex items-center gap-4 text-sm">
            <span class="font-mono text-gray-300 flex-1 truncate">${f.path}</span>
            <span style="color: ${getStatusColor(f.lines.pct)}">${f.lines.pct.toFixed(1)}%</span>
          </div>
        `).join('')}
        ${lowCoverageFiles.length > 10 ? `<p class="text-gray-500 text-sm">...and ${lowCoverageFiles.length - 10} more files</p>` : ''}
      </div>
    </div>
    ` : ''}

    <!-- File Coverage Table -->
    <div class="card rounded-lg overflow-hidden">
      <div class="p-4" style="background-color: #0f3460">
        <h2 class="font-semibold">All Files (${files.length})</h2>
      </div>
      <div class="max-h-96 overflow-y-auto">
        <table class="w-full text-sm">
          <thead class="sticky top-0" style="background-color: #16213e">
            <tr class="text-gray-400 text-left">
              <th class="p-3">File</th>
              <th class="p-3 text-right">Lines</th>
              <th class="p-3 text-right">Statements</th>
              <th class="p-3 text-right">Functions</th>
              <th class="p-3 text-right">Branches</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-700">
            ${files.map(f => `
              <tr class="hover:bg-gray-800">
                <td class="p-3 font-mono text-xs truncate max-w-xs">${f.path}</td>
                <td class="p-3 text-right" style="color: ${getStatusColor(f.lines.pct)}">${f.lines.pct.toFixed(1)}%</td>
                <td class="p-3 text-right" style="color: ${getStatusColor(f.statements.pct)}">${f.statements.pct.toFixed(1)}%</td>
                <td class="p-3 text-right" style="color: ${getStatusColor(f.functions.pct)}">${f.functions.pct.toFixed(1)}%</td>
                <td class="p-3 text-right" style="color: ${getStatusColor(f.branches.pct)}">${f.branches.pct.toFixed(1)}%</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <footer class="mt-8 text-center text-gray-500 text-sm">
      <p>SparseTree Coverage Report • <a href="/" class="text-blue-400 hover:underline">Back to App</a></p>
    </footer>
  </div>
</body>
</html>`;
}

async function main() {
  console.log('Generating code coverage dashboard...');

  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // Check if detailed report exists (generated by vitest)
  const detailedReportPath = path.join(OUTPUT_DIR, 'index.html');
  const hasDetailedReport = fs.existsSync(detailedReportPath);

  // Generate dashboard HTML
  const html = generateHTML();

  // If detailed report exists, save as dashboard.html instead
  const outputPath = hasDetailedReport
    ? path.join(OUTPUT_DIR, 'dashboard.html')
    : path.join(OUTPUT_DIR, 'index.html');

  fs.writeFileSync(outputPath, html);

  // Load and print summary
  const coverage = loadCoverageSummary();
  if (coverage) {
    console.log('\n📊 Code Coverage Summary:');
    console.log(`   Lines:      ${coverage.total.lines.pct.toFixed(1)}% (${coverage.total.lines.covered}/${coverage.total.lines.total})`);
    console.log(`   Statements: ${coverage.total.statements.pct.toFixed(1)}% (${coverage.total.statements.covered}/${coverage.total.statements.total})`);
    console.log(`   Functions:  ${coverage.total.functions.pct.toFixed(1)}% (${coverage.total.functions.covered}/${coverage.total.functions.total})`);
    console.log(`   Branches:   ${coverage.total.branches.pct.toFixed(1)}% (${coverage.total.branches.covered}/${coverage.total.branches.total})`);
  } else {
    console.log('\n⚠️  No coverage data found. Run "npm run test:coverage" first.');
  }

  console.log(`\n✅ Dashboard generated: ${outputPath}`);
}

main();
