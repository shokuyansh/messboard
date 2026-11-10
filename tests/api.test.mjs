import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest, campusDate } from '../lib/mess-api.js';
import { testDatabase } from './d1-adapter.mjs';

const admin = { userId: 'owner-1', email: 'owner@example.test', displayName: 'Mess Administrator' };
const alice = { userId: 'alice-1', email: 'alice@example.test', displayName: 'Alice Student' };
const bob = { userId: 'bob-1', email: 'bob@example.test', displayName: 'Bob Student' };
const today = '2026-11-05';
function fixture(t) {
  const db = testDatabase(); t.after(() => db.close());
  async function request(identity, path, method = 'GET', data, headers = {}) {
    const response = await handleRequest(new Request(`https://mess.test/api/${path}`, { method, headers: { 'X-Mess-Request': '1', Origin: 'https://mess.test', ...(data !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers }, ...(data !== undefined ? { body: JSON.stringify(data) } : {}) }), db, identity, { adminEmail: admin.email, today });
    return { status: response.status, data: await response.json() };
  }
  const bootstrap = identity => request(identity, 'bootstrap', 'POST', {});
  const profile = (identity, roll) => request(identity, 'profile', 'PATCH', { name: identity.displayName, roll, hostel: 'Hostel A' });
  return { db, request, bootstrap, profile };
}

test('campus date follows Asia/Kolkata, including UTC midnight boundaries', () => {
  assert.equal(campusDate(new Date('2026-11-04T19:00:00Z')), '2026-11-05');
  assert.equal(campusDate(new Date('2026-11-04T18:00:00Z')), '2026-11-04');
});

test('anonymous requests, cross-origin writes, and missing CSRF headers are rejected', async t => {
  const f = fixture(t);
  assert.equal((await f.request(null, 'bootstrap', 'POST', {})).status, 401);
  assert.equal((await f.request(alice, 'bootstrap', 'POST', {}, { Origin: 'https://attacker.test' })).status, 403);
  assert.equal((await f.request(alice, 'bootstrap', 'POST', {}, { 'X-Mess-Request': '' })).status, 403);
  assert.equal((await f.request(alice, 'bootstrap', 'POST', {}, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
});

test('only configured owner becomes admin; client role and student IDs are ignored', async t => {
  const f = fixture(t);
  const first = await f.request(alice, 'bootstrap', 'POST', { role: 'admin', studentId: admin.userId });
  assert.equal(first.data.profile.role, 'student');
  assert.equal((await f.bootstrap(admin)).data.profile.role, 'admin');
  assert.equal((await f.request(alice, 'admin/overview')).status, 403);
  assert.equal(first.data.menus.length, 21);
  assert.equal(first.data.bills[0].amount, 3200);
  assert.deepEqual(first.data.bookings, {});
});

test('profile validation and unique roll numbers are enforced in the database', async t => {
  const f = fixture(t); await f.bootstrap(alice); await f.bootstrap(bob);
  assert.equal((await f.profile(alice, 'b124001')).status, 200);
  assert.equal((await f.profile(bob, 'B124001')).status, 409);
  assert.equal((await f.profile(bob, "DROP TABLE students;")).status, 400);
  assert.equal((await f.request(alice, 'profile', 'PATCH', { name: 'Alice', roll: 'B124001', hostel: 'Hostel A', role: 'admin' })).status, 200);
  assert.equal((await f.request(alice, 'state')).data.profile.role, 'student');
});

test('bookings require a profile, a real date, a valid meal and the allowed date window', async t => {
  const f = fixture(t); await f.bootstrap(alice);
  assert.equal((await f.request(alice, 'bookings', 'POST', { date: today, meal: 0, status: 'booked' })).status, 409);
  await f.profile(alice, 'B124001');
  for (const date of ['2026-11-04', '2026-12-06', '2026-11-31', 'bad']) assert.equal((await f.request(alice, 'bookings', 'POST', { date, meal: 0, status: 'booked' })).status, 400);
  assert.equal((await f.request(alice, 'bookings', 'POST', { date: today, meal: 4, status: 'booked' })).status, 400);
  assert.equal((await f.request(alice, 'bookings', 'POST', { date: today, meal: 0, status: 'booked' })).status, 200);
});

test('attendance requires a current booked meal, prevents duplicates and locks served bookings', async t => {
  const f = fixture(t); await f.bootstrap(alice); await f.profile(alice, 'B124001');
  assert.equal((await f.request(alice, 'attendance', 'POST', { date: today, meal: 0 })).status, 409);
  await f.request(alice, 'bookings', 'POST', { date: today, meal: 0, status: 'booked' });
  assert.equal((await f.request(alice, 'attendance', 'POST', { date: '2026-11-04', meal: 0 })).status, 400);
  const attempts = await Promise.all([f.request(alice, 'attendance', 'POST', { date: today, meal: 0 }), f.request(alice, 'attendance', 'POST', { date: today, meal: 0 })]);
  assert.deepEqual(attempts.map(item => item.status).sort(), [200, 409]);
  assert.equal((await f.request(alice, 'bookings', 'POST', { date: today, meal: 0, status: 'skipped' })).status, 409);
  assert.equal(Object.keys((await f.request(alice, 'state')).data.attendance).length, 1);
});

test('students cannot read or mutate another student’s bookings and attendance', async t => {
  const f = fixture(t); await f.bootstrap(alice); await f.bootstrap(bob); await f.profile(alice, 'B124001'); await f.profile(bob, 'B124002');
  await f.request(alice, 'bookings', 'POST', { date: today, meal: 1, status: 'booked', studentId: bob.userId });
  assert.equal((await f.request(alice, 'state')).data.bookings[`${today}_1`], 'booked');
  assert.deepEqual((await f.request(bob, `state?studentId=${alice.userId}`)).data.bookings, {});
});

test('payment simulations use the server bill amount and cannot be recorded twice', async t => {
  const f = fixture(t); await f.bootstrap(alice); await f.profile(alice, 'B124001');
  const attempts = await Promise.all([f.request(alice, 'payments/simulate', 'POST', { month: '2026-11', amount: 1 }), f.request(alice, 'payments/simulate', 'POST', { month: '2026-11' })]);
  assert.deepEqual(attempts.map(item => item.status).sort(), [200, 409]);
  const state = (await f.request(alice, 'state')).data;
  assert.equal(state.payments.length, 1); assert.equal(state.payments[0].amount, 3200);
  assert.match(state.payments[0].id, /^SIM-/);
  assert.equal((await f.request(alice, 'payments/simulate', 'POST', { month: '2025-01' })).status, 409);
});

test('admin billing updates pending bills, preserves paid amounts, and applies to new students', async t => {
  const f = fixture(t); await f.bootstrap(admin); await f.bootstrap(alice); await f.profile(alice, 'B124001');
  await f.request(alice, 'payments/simulate', 'POST', { month: '2026-11' });
  assert.equal((await f.request(admin, 'admin/bills', 'POST', { month: '2026-11', amount: 3500 })).status, 200);
  assert.equal((await f.request(admin, 'state')).data.bills[0].amount, 3500);
  assert.equal((await f.request(alice, 'state')).data.bills[0].amount, 3200);
  assert.equal((await f.bootstrap(bob)).data.bills[0].amount, 3500);
  assert.equal((await f.request(alice, 'admin/bills', 'POST', { month: '2026-11', amount: 0 })).status, 403);
});

test('shared menu and notices survive bootstrap, while student writes are denied', async t => {
  const f = fixture(t); await f.bootstrap(admin); await f.bootstrap(alice);
  const update = { weekday: 3, meal: 1, description: 'Special vegetable thali & curd', diet: 'Vegetarian' };
  assert.equal((await f.request(alice, 'admin/menu', 'PATCH', update)).status, 403);
  assert.equal((await f.request(admin, 'admin/menu', 'PATCH', update)).status, 200);
  await f.request(admin, 'admin/notices', 'POST', { title: 'Lunch timing', body: 'Lunch will be served as scheduled today.' });
  await f.request(admin, 'admin/notices', 'DELETE', { id: 'welcome' });
  const state = (await f.bootstrap(alice)).data;
  assert.equal(state.menus.find(item => item.weekday === 3 && item.meal === 1).description, update.description);
  assert.deepEqual(state.notices.map(item => item.title), ['Lunch timing']);
});

test('feedback validation, user isolation, and admin review are persisted', async t => {
  const f = fixture(t); await f.bootstrap(admin); await f.bootstrap(alice); await f.bootstrap(bob);
  const feedback = { category: 'Food quality', rating: 4, message: '<img src=x onerror=alert(1)> Add seasonal fruit, please.' };
  assert.equal((await f.request(alice, 'feedback', 'POST', { ...feedback, rating: 6 })).status, 400);
  assert.equal((await f.request(alice, 'feedback', 'POST', { ...feedback, message: 'short' })).status, 400);
  assert.equal((await f.request(alice, 'feedback', 'POST', feedback)).status, 201);
  const saved = (await f.request(alice, 'state')).data.feedback[0];
  assert.equal(saved.message, feedback.message);
  assert.deepEqual((await f.request(bob, 'state')).data.feedback, []);
  assert.equal((await f.request(alice, 'admin/feedback', 'PATCH', { id: saved.id, status: 'reviewed' })).status, 403);
  assert.equal((await f.request(admin, 'admin/feedback', 'PATCH', { id: saved.id, status: 'reviewed' })).status, 200);
  assert.equal((await f.request(alice, 'state')).data.feedback[0].status, 'reviewed');
});

test('administrators can deactivate accounts but cannot disable their own access', async t => {
  const f = fixture(t); await f.bootstrap(admin); await f.bootstrap(alice);
  assert.equal((await f.request(admin, 'admin/students', 'PATCH', { id: admin.userId, role: 'student', active: false })).status, 400);
  assert.equal((await f.request(admin, 'admin/students', 'PATCH', { id: alice.userId, role: 'student', active: false })).status, 200);
  assert.equal((await f.request(alice, 'state')).status, 403);
  assert.equal((await f.bootstrap(alice)).status, 403);
  await f.request(admin, 'admin/students', 'PATCH', { id: alice.userId, role: 'admin', active: true });
  assert.equal((await f.request(alice, 'admin/overview')).status, 200);
});

test('oversized requests are rejected and database constraints reject invalid records', async t => {
  const f = fixture(t); await f.bootstrap(alice);
  assert.equal((await f.request(alice, 'feedback', 'POST', { message: 'a'.repeat(17000) })).status, 413);
  assert.throws(() => f.db.sqlite.prepare('INSERT INTO attendance VALUES (?,?,?,?)').run('nonexistent', today, 0, 'now'), /FOREIGN KEY/);
  assert.throws(() => f.db.sqlite.prepare('UPDATE students SET role=? WHERE id=?').run('superuser', alice.userId), /CHECK constraint/);
});
