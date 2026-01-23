#!/usr/bin/env npx tsx
/**
 * Calculate max generations for a root without re-indexing
 * Uses BFS from root through parent_edge with cycle detection
 */
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new Database(path.join(__dirname, '../data/sparsetree.db'));

const rootId = process.argv[2] || '01KFKFZG0XKA8DQRW923JEWP4V';
const dbId = rootId;

console.log('Calculating generations for root:', rootId);

// BFS with visited tracking (same algorithm as finalizeDatabase)
const generations = new Map<string, number>();
const queue: {id: string, gen: number}[] = [{ id: rootId, gen: 0 }];
const visited = new Set<string>();

// Get all parent edges for faster lookup
console.log('Loading parent edges...');
const parentEdges = db.prepare('SELECT child_id, parent_id FROM parent_edge').all() as {child_id: string, parent_id: string}[];
const parentMap = new Map<string, string[]>();
for (const edge of parentEdges) {
  const arr = parentMap.get(edge.child_id) || [];
  arr.push(edge.parent_id);
  parentMap.set(edge.child_id, arr);
}

console.log('Loaded', parentEdges.length, 'parent edges');
console.log('Running BFS...');

while (queue.length > 0) {
  const item = queue.shift();
  if (!item || visited.has(item.id)) continue;
  visited.add(item.id);
  generations.set(item.id, item.gen);

  const parents = parentMap.get(item.id) || [];
  for (const parentId of parents) {
    if (!visited.has(parentId)) {
      queue.push({ id: parentId, gen: item.gen + 1 });
    }
  }
}

let maxGen = 0;
for (const gen of generations.values()) {
  if (gen > maxGen) maxGen = gen;
}
console.log('Max generation:', maxGen);
console.log('Total persons:', generations.size);

// Update database_info
db.prepare('UPDATE database_info SET max_generations = ?, person_count = ? WHERE db_id = ?')
  .run(maxGen, generations.size, dbId);

console.log('Updated database_info');
db.close();
