import { createClient } from '@libsql/client';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export function databaseAdapter(client) {
  const convert = result => ({ success: true, results: result.rows.map(row => Object.fromEntries(result.columns.map((name, index) => [name, typeof row[index] === 'bigint' ? Number(row[index]) : row[index]]))), meta: { changes: result.rowsAffected } });
  const statement = (sql, args = []) => ({
    query: { sql, args },
    bind(...values) { return statement(sql, values); },
    async first() { return convert(await client.execute({ sql, args })).results[0] || null; },
    async all() { return convert(await client.execute({ sql, args })); },
    async run() { return convert(await client.execute({ sql, args })); },
  });
  return {
    prepare: statement,
    async readBatch(statements) { return (await client.batch(statements.map(item => item.query), 'read')).map(convert); },
    async batch(statements) { return (await client.batch(statements.map(item => item.query), 'write')).map(convert); },
  };
}

let connection;
export async function getConnection() {
  if (!connection) connection = connect().catch(error => { connection = undefined; throw error; });
  return connection;
}

async function connect() {
  const url = process.env.TURSO_DATABASE_URL || (process.env.VERCEL ? '' : 'file:.data/mess.db');
  if (!url) throw new Error('Connect a Turso database and set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN.');
  if (process.env.VERCEL && !/^(libsql|https):\/\//.test(url)) throw new Error('Vercel requires a persistent remote database; file and in-memory URLs are disabled.');
  if (process.env.VERCEL && !process.env.TURSO_AUTH_TOKEN) throw new Error('Set TURSO_AUTH_TOKEN for the remote database.');
  if (url.startsWith('file:')) await mkdir(dirname(url.slice(5)), { recursive: true });
  const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN || undefined });
  await client.execute('PRAGMA foreign_keys=ON');
  return { client, db: databaseAdapter(client) };
}
