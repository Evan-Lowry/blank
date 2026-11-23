// Local stand-ins for the Sites D1 (DB) and R2 (BUCKET) bindings. Data lives in .local/.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

const root = '.local';
mkdirSync(join(root, 'r2'), { recursive: true });
const sqlite = new DatabaseSync(join(root, 'db.sqlite'));
sqlite.exec('CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY)');
for (const name of readdirSync('drizzle').filter(file => file.endsWith('.sql')).sort()) {
  if (sqlite.prepare('SELECT 1 FROM _migrations WHERE name = ?').get(name)) continue;
  for (const statement of readFileSync(join('drizzle', name), 'utf8').split('--> statement-breakpoint')) {
    if (statement.trim()) sqlite.exec(statement);
  }
  sqlite.prepare('INSERT INTO _migrations (name) VALUES (?)').run(name);
}

const DB = {
  prepare(sql) {
    const statement = sqlite.prepare(sql);
    const make = args => ({
      bind: (...values) => make(values),
      first: async () => statement.get(...args) ?? null,
      all: async () => ({ results: statement.all(...args) }),
      run: async () => ({ meta: { changes: Number(statement.run(...args).changes) } }),
    });
    return make([]);
  },
};

const file = key => join(root, 'r2', encodeURIComponent(key));
const BUCKET = {
  async put(key, value) { writeFileSync(file(key), new Uint8Array(await new Response(value).arrayBuffer())); },
  async get(key) {
    if (!existsSync(file(key))) return null;
    const bytes = readFileSync(file(key));
    return { size: bytes.length, body: new Blob([bytes]).stream() };
  },
  async delete(key) { rmSync(file(key), { force: true }); },
};

export const bindings = { DB, BUCKET };
