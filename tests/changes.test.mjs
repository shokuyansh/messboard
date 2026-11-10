import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createClient } from '@libsql/client';
import { databaseAdapter } from '../lib/database.js';
import { migrate } from '../scripts/migrate.mjs';
import { handleApp } from '../lib/app-handler.js';
import { emailError } from '../public/email-validation.js';

const password = 'test-student-password-123';
async function fixture(t) {
  const client = createClient({ url: ':memory:' });
  await client.execute('PRAGMA foreign_keys=ON');
  await migrate(client);
  t.after(() => client.close());
  const db = databaseAdapter(client);
  const request = async (path, data, cookie = '') => {
    const response = await handleApp(new Request(`https://mess.test/api/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Mess-Request': '1', Origin: 'https://mess.test', Cookie: cookie }, body: JSON.stringify(data) }), db);
    return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  };
  return { client, db, request };
}

test('invalid email addresses have a clear error on both sign-in and registration', async t => {
  const f = await fixture(t);
  for (const email of ['', 'student', 'a@b', 'a@@example.com', 'a..b@example.com', '.a@example.com', 'a@example..com', 'a@-example.com', 'a@example-.com', 'a@exam_ple.com', 'a b@example.com']) {
    assert.ok(emailError(email));
    for (const path of ['auth/login', 'auth/register']) {
      const response = await f.request(path, { name: 'Test Student', email, password });
      assert.equal(response.status, 400, `${path}: ${email}`);
      assert.match(response.data.error, /email address/);
    }
  }
  for (const email of ['student@example.com', 'first.last+mess@iiit-bh.ac.in', ' STUDENT@example.com ']) assert.equal(emailError(email), '');
});

test('booking needs one session read and one write batch, and returns confirmed data', async t => {
  const f = await fixture(t);
  const user = await f.request('auth/register', { name: 'Test Student', email: 'student@example.test', password });
  const state = await f.request('bootstrap', {}, user.cookie);
  await f.client.execute("UPDATE students SET roll='B124123'");
  let reads = 0, batches = 0;
  const execute = f.client.execute.bind(f.client), batch = f.client.batch.bind(f.client);
  f.client.execute = (...args) => { reads++; return execute(...args); };
  f.client.batch = (...args) => { batches++; return batch(...args); };
  const result = await f.request('bookings', { date: state.data.today, meal: 1, status: 'booked' }, user.cookie);
  assert.equal(result.status, 200);
  assert.deepEqual(result.data.booking, { date: state.data.today, meal: 1, status: 'booked' });
  assert.equal(reads, 1); assert.equal(batches, 1);
  assert.equal((await execute('SELECT COUNT(*) AS count FROM activity')).rows[0].count, 1);
  const checkin = await f.request('attendance', { date: state.data.today, meal: 1 }, user.cookie);
  assert.equal(checkin.status, 200); assert.ok(checkin.data.attendance.checkedAt);
  assert.deepEqual(checkin.data.charge, { month: state.data.today.slice(0,7), meal:1, amount:45 });
  const locked = await f.request('bookings', { date: state.data.today, meal: 1, status: 'skipped' }, user.cookie);
  assert.equal(locked.status, 409);
  assert.equal((await execute('SELECT COUNT(*) AS count FROM activity')).rows[0].count, 2);
});

test('migration preserves legacy bill amounts, resets simulations and removes hostel data', async t => {
  const client = createClient({ url: ':memory:' }); t.after(() => client.close());
  await client.execute('PRAGMA foreign_keys=ON');
  for (const file of ['0000_watery_archangel.sql', '0001_motionless_yellowjacket.sql', '0002_accounts.sql']) {
    const sql = await readFile(new URL(`../drizzle/${file}`, import.meta.url), 'utf8');
    await client.batch(sql.split('--> statement-breakpoint').map(sql => sql.trim()).filter(Boolean), 'write');
  }
  await client.execute("INSERT INTO students (id,email,name,roll,hostel,created_at) VALUES ('s','s@example.com','Student','B123','Hostel C','now')");
  await client.execute("INSERT INTO bills VALUES ('s','2026-11',3400,'simulated_paid','now','SIM-test')");
  await client.execute("INSERT INTO activity VALUES ('a','s','Simulated payment recorded','legacy','wallet','now')");
  const sql = await readFile(new URL('../drizzle/0003_pending_bills_and_profiles.sql', import.meta.url), 'utf8');
  await client.batch(sql.split('--> statement-breakpoint').map(sql => sql.trim()).filter(Boolean), 'write');
  const bill = (await client.execute('SELECT * FROM bills')).rows[0];
  assert.equal(bill.amount, 3400); assert.equal(bill.status, 'pending');
  assert.equal('receipt' in bill, false);
  assert.equal((await client.execute('PRAGMA table_info(students)')).rows.some(row => row.name === 'hostel'), false);
  assert.equal((await client.execute('SELECT COUNT(*) AS count FROM activity')).rows[0].count, 0);
  assert.deepEqual((await client.execute('PRAGMA foreign_key_check')).rows, []);
});
