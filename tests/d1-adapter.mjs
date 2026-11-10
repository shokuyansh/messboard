import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';

// Test-only adapter runs the real parameterized SQL and migrations against SQLite.
export function testDatabase(filename = ':memory:') {
  const sqlite = new DatabaseSync(filename);
  sqlite.exec('PRAGMA foreign_keys=ON');
  for (const filename of readdirSync(new URL('../drizzle/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) {
    sqlite.exec(readFileSync(new URL(`../drizzle/${filename}`, import.meta.url), 'utf8'));
  }
  const statement = (sql, values = []) => ({
    bind(...args) { return statement(sql, args); },
    async first() { return sqlite.prepare(sql).get(...values) || null; },
    async all() { return { results: sqlite.prepare(sql).all(...values), success: true }; },
    runSync() { const result = sqlite.prepare(sql).run(...values); return { success: true, meta: { changes: Number(result.changes) } }; },
    async run() { return this.runSync(); },
  });
  return {
    sqlite, prepare: statement,
    async batch(statements) {
      sqlite.exec('BEGIN');
      try { const results = []; for (const item of statements) results.push(item.runSync()); sqlite.exec('COMMIT'); return results; }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
    close() { sqlite.close(); },
  };
}
