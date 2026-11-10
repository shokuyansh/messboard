import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { getConnection } from '../lib/database.js';

export async function migrate(client) {
  await client.execute('CREATE TABLE IF NOT EXISTS mess_migrations (name TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL)');
  const directory = new URL('../drizzle/', import.meta.url);
  for (const name of (await readdir(directory)).filter(name => name.endsWith('.sql')).sort()) {
    const sql = await readFile(new URL(name, directory), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    const saved = await client.execute({ sql: 'SELECT checksum FROM mess_migrations WHERE name=?', args: [name] });
    if (saved.rows.length) {
      if (saved.rows[0].checksum !== checksum) throw new Error(`Applied migration ${name} has changed.`);
      continue;
    }
    await client.batch([
      ...sql.split('--> statement-breakpoint').map(sql => sql.trim()).filter(Boolean).map(sql => ({ sql, args: [] })),
      { sql: 'INSERT INTO mess_migrations (name,checksum,applied_at) VALUES (?,?,?)', args: [name, checksum, new Date().toISOString()] },
    ], 'write');
    console.log(`Applied migration: ${name}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { client } = await getConnection();
  try { await migrate(client); console.log('Database is up to date.'); }
  finally { client.close(); }
}
