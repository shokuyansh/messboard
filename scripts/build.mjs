import { access, readFile } from 'node:fs/promises';
import { getConnection } from '../lib/database.js';
import { migrate } from './migrate.mjs';

for (const file of ['public/index.html', 'public/app.js', 'public/styles.css', 'api/index.js']) await access(file);
const html = await readFile('public/index.html', 'utf8');
if (!html.includes('id="main"')) throw new Error('The application shell is missing.');
if (process.env.VERCEL) {
  if (!process.env.ADMIN_EMAIL || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(process.env.ADMIN_EMAIL)) throw new Error('Set ADMIN_EMAIL before deploying.');
  if (!process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD.length < 12) throw new Error('Set a unique ADMIN_PASSWORD of at least 12 characters before deploying.');
}
const { client } = await getConnection();
try { await migrate(client); }
finally { client.close(); }
console.log('Vercel static frontend, Node.js API, and database migrations are ready.');
