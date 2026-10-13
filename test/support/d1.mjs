import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
export class D1 {
  constructor({ through = Infinity } = {}) {
    this.sqlite = new DatabaseSync(':memory:');
    for (const migration of readdirSync(new URL('../../migrations/', import.meta.url)).filter(name => name.endsWith('.sql') && parseInt(name, 10) <= through).sort()) this.sqlite.exec(readFileSync(new URL(`../../migrations/${migration}`, import.meta.url), 'utf8'));
    this.sqlite.exec('PRAGMA foreign_keys = ON');
  }
  async exec(sql) { this.sqlite.exec(sql); return { count: 0, duration: 0 }; }
  async batch(statements) {
    this.sqlite.exec('BEGIN');
    try { const results = []; for (const statement of statements) results.push(await statement.run()); this.sqlite.exec('COMMIT'); return results; }
    catch (error) { this.sqlite.exec('ROLLBACK'); throw error; }
  }
  prepare(sql) {
    const statement = this.sqlite.prepare(sql); let values = [];
    const db = this.sqlite;
    return {
      bind(...args) { values = args; return this; },
      async first() { return statement.get(...values) || null; },
      async all() { const results = statement.all(...values); const meta = db.prepare('SELECT changes() AS changes, last_insert_rowid() AS last_row_id').get(); return { results, meta, success: true }; },
      async run() { const results = statement.all(...values); return { results, meta: { changes: db.prepare('SELECT changes() AS n').get().n } }; },
    };
  }
}
