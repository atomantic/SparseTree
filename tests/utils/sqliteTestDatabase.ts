import { createRequire } from 'node:module';
import path from 'node:path';
import initSqlJs, { type Database as SqlJsDatabase, type SqlJsStatic } from 'sql.js';

const require = createRequire(import.meta.url);
const SQL: SqlJsStatic = await initSqlJs({
  locateFile: filename => path.join(path.dirname(require.resolve('sql.js')), filename),
});

type SqlParams = Record<string, unknown> | readonly unknown[];
interface RunResult { changes: number }

function normalizeParams(params: readonly unknown[]): SqlParams | undefined {
  if (params.length === 0) return undefined;
  const [first] = params;
  if (params.length === 1 && first !== null && typeof first === 'object' && !Array.isArray(first) && !(first instanceof Uint8Array)) {
    return Object.fromEntries(Object.entries(first as Record<string, unknown>).map(([name, value]) => [
      /^[\$:@]/.test(name) ? name : `@${name}`,
      value === undefined ? null : typeof value === 'boolean' ? Number(value) : value,
    ]));
  }
  return params.map(value => value === undefined ? null : typeof value === 'boolean' ? Number(value) : value);
}

/** Small in-memory SQLite adapter for route integration tests; production uses PostgreSQL. */
export class SqliteTestDatabase {
  private readonly raw: SqlJsDatabase;

  constructor() {
    this.raw = new SQL.Database();
  }

  exec(sql: string): void {
    this.raw.exec(sql);
  }

  prepare(sql: string) {
    const all = (...params: unknown[]): Array<Record<string, unknown>> => {
      const statement = this.raw.prepare(sql, normalizeParams(params));
      try {
        const rows: Array<Record<string, unknown>> = [];
        while (statement.step()) rows.push(statement.getAsObject() as Record<string, unknown>);
        return rows;
      } finally {
        statement.free();
      }
    };
    const run = (...params: unknown[]): RunResult => {
      this.raw.run(sql, normalizeParams(params));
      return { changes: this.raw.getRowsModified() };
    };
    return {
      all,
      get: (...params: unknown[]) => all(...params)[0],
      run,
    };
  }

  close(): void {
    this.raw.close();
  }
}
