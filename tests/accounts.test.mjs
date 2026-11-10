import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@libsql/client';
import { spawnSync } from 'node:child_process';
import { databaseAdapter } from '../lib/database.js';
import { migrate } from '../scripts/migrate.mjs';
import { handleApp } from '../lib/app-handler.js';

const config = { adminEmail: 'owner@example.test', adminPassword: 'test-admin-password-123' };
const password = 'test-student-password-123';
async function fixture(t) {
  const client = createClient({ url: ':memory:' });
  await client.execute('PRAGMA foreign_keys=ON'); await migrate(client);
  t.after(() => client.close());
  const db = databaseAdapter(client);
  const request = async (path, method = 'GET', data, cookie = '', headers = {}) => {
    const response = await handleApp(new Request(`https://mess.test${path}`, { method, headers: { 'X-Mess-Request': '1', Origin: 'https://mess.test', ...(cookie ? { Cookie: cookie } : {}), ...(data !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers }, ...(data !== undefined ? { body: JSON.stringify(data) } : {}) }), db, config);
    return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0], setCookie: response.headers.get('set-cookie') };
  };
  const register = email => request('/api/auth/register', 'POST', { name: 'Student Test', email, password });
  return { client, db, request, register };
}

test('Vercel identity headers cannot impersonate an account', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/api/bootstrap', 'POST', {}, '', { 'oai-authenticated-user-id': 'owner', 'oai-authenticated-user-email': config.adminEmail })).status, 401);
});

test('registration creates student-only accounts and stores salted password hashes and hashed sessions', async t => {
  const f = await fixture(t);
  const result = await f.request('/api/auth/register', 'POST', { name: 'Student Test', email: 'student@example.test', password, role: 'admin' });
  assert.equal(result.status, 200);
  assert.match(result.setCookie, /HttpOnly/); assert.match(result.setCookie, /SameSite=Lax/); assert.match(result.setCookie, /Secure/); assert.match(result.cookie, /^__Host-/);
  const user = await f.db.prepare('SELECT * FROM students').first();
  assert.equal(user.role, 'student');
  const credentials = await f.db.prepare('SELECT * FROM auth_credentials').first();
  assert.notEqual(credentials.password_hash, password); assert.equal(credentials.password_salt.length, 32);
  const session = await f.db.prepare('SELECT token_hash FROM auth_sessions').first();
  assert.notEqual(session.token_hash, result.cookie.split('=')[1]);
  assert.equal((await f.request('/api/bootstrap', 'POST', {}, result.cookie)).data.profile.role, 'student');
});

test('reserved administrator email cannot be registered or claimed with the wrong password', async t => {
  const f = await fixture(t);
  assert.equal((await f.register(config.adminEmail)).status, 409);
  assert.equal((await f.request('/api/auth/login', 'POST', { email: config.adminEmail, password })).status, 401);
  const login = await f.request('/api/auth/login', 'POST', { email: config.adminEmail, password: config.adminPassword });
  assert.equal(login.status, 200);
  assert.equal((await f.request('/api/bootstrap', 'POST', {}, login.cookie)).data.profile.role, 'admin');
  assert.equal((await f.request('/api/admin/overview', 'GET', undefined, login.cookie)).status, 200);
});

test('separate login sessions load persistent records; logout revokes only the current session', async t => {
  const f = await fixture(t), first = await f.register('student@example.test');
  const state = await f.request('/api/bootstrap', 'POST', {}, first.cookie);
  await f.request('/api/profile', 'PATCH', { name: 'Student Test', roll: 'B124123', hostel: 'Hostel A' }, first.cookie);
  await f.request('/api/bookings', 'POST', { date: state.data.today, meal: 1, status: 'booked' }, first.cookie);
  const second = await f.request('/api/auth/login', 'POST', { email: 'STUDENT@example.test', password });
  assert.equal(second.status, 200); assert.notEqual(first.cookie, second.cookie);
  const loaded = await f.request('/api/bootstrap', 'POST', {}, second.cookie);
  assert.equal(loaded.data.profile.roll, 'B124123'); assert.equal(loaded.data.bookings[`${state.data.today}_1`], 'booked');
  assert.equal((await f.request('/api/auth/logout', 'POST', {}, first.cookie)).status, 200);
  assert.equal((await f.request('/api/state', 'GET', undefined, first.cookie)).status, 401);
  assert.equal((await f.request('/api/state', 'GET', undefined, second.cookie)).status, 200);
});

test('sessions expire and inactive accounts cannot use existing sessions or sign in', async t => {
  const f = await fixture(t), user = await f.register('student@example.test');
  await f.request('/api/bootstrap', 'POST', {}, user.cookie);
  await f.db.prepare('UPDATE students SET active=0').run();
  assert.equal((await f.request('/api/state', 'GET', undefined, user.cookie)).status, 403);
  assert.equal((await f.request('/api/auth/login', 'POST', { email: 'student@example.test', password })).status, 403);
  await f.db.prepare('UPDATE students SET active=1').run();
  await f.db.prepare('UPDATE auth_sessions SET expires_at=?').bind('2000-01-01T00:00:00.000Z').run();
  assert.equal((await f.request('/api/state', 'GET', undefined, user.cookie)).status, 401);
});

test('account requests enforce origin, request headers, password length and attempt limits', async t => {
  const f = await fixture(t);
  const input = { name: 'Test Student', email: 'student@example.test', password };
  assert.equal((await f.request('/api/auth/register', 'POST', input, '', { Origin: 'https://attacker.test' })).status, 403);
  assert.equal((await f.request('/api/auth/register', 'POST', input, '', { 'X-Mess-Request': '' })).status, 403);
  assert.equal((await f.request('/api/auth/register', 'POST', { ...input, password: 'short' })).status, 400);
  for (let i=0; i<10; i++) assert.equal((await f.request('/api/auth/login', 'POST', { email: 'absent@example.test', password })).status, 401);
  assert.equal((await f.request('/api/auth/login', 'POST', { email: 'absent@example.test', password })).status, 429);
});

test('Vercel rewrite query is normalized without losing JSON body or report filters', async t => {
  const f = await fixture(t);
  const result = await f.request('/api?__path=auth/register', 'POST', { name: 'Test Student', email: 'student@example.test', password });
  assert.equal(result.status, 200);
  assert.equal((await f.request('/api?__path=bootstrap', 'POST', {}, result.cookie)).status, 200);
  assert.equal((await f.request('/api?__path=state', 'GET', undefined, result.cookie)).data.profile.email, 'student@example.test');
  assert.equal((await f.request('/api?__path=../admin', 'GET', undefined, result.cookie)).status, 400);
});

test('duplicate account registration rolls back all SQL inserts', async t => {
  const f = await fixture(t);
  const attempts = await Promise.all([f.register('student@example.test'), f.register('student@example.test')]);
  assert.deepEqual(attempts.map(result => result.status).sort(), [200, 409]);
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS count FROM students').first()).count, 1);
});

test('migrations are repeatable and remote deployment refuses temporary local databases', async t => {
  const f = await fixture(t); await migrate(f.client);
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS count FROM mess_migrations').first()).count, 3);
  const result = spawnSync(process.execPath, ['scripts/build.mjs'], { cwd: new URL('..', import.meta.url), env: { ...process.env, VERCEL: '1', ADMIN_EMAIL: config.adminEmail, ADMIN_PASSWORD: config.adminPassword, TURSO_DATABASE_URL: 'file:.data/invalid-production.db' }, encoding: 'utf8' });
  assert.notEqual(result.status, 0); assert.match(result.stderr, /persistent remote database/);
});
