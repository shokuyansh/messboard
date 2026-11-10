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
  const profile = (identity, roll) => request(identity, 'profile', 'PATCH', { name: identity.displayName, roll });
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
  assert.deepEqual(first.data.bills, []);
  assert.deepEqual(first.data.mealRates, [30,45,40]);
  assert.deepEqual(first.data.bookings, {});
});

test('profile validation and unique roll numbers are enforced in the database', async t => {
  const f = fixture(t); await f.bootstrap(alice); await f.bootstrap(bob);
  assert.equal((await f.profile(alice, 'b124001')).status, 200);
  assert.equal((await f.profile(bob, 'B124001')).status, 409);
  assert.equal((await f.profile(bob, "DROP TABLE students;")).status, 400);
  assert.equal((await f.request(alice, 'profile', 'PATCH', { name: 'Alice', roll: 'B124001', role: 'admin' })).status, 200);
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

test('students see pending bills and cannot settle them through the removed payment endpoint', async t => {
  const f = fixture(t); await f.bootstrap(alice); await f.profile(alice, 'B124001');
  assert.equal((await f.request(alice, 'payments/simulate', 'POST', { month: '2026-11' })).status, 404);
  const state = (await f.request(alice, 'state')).data;
  assert.deepEqual(state.bills, []);
  assert.equal('payments' in state, false);
  assert.equal('hostel' in state.profile, false);
});

test('dues use attended meals at fixed prices, isolate accounts, and ignore legacy flat bills', async t => {
  const f = fixture(t); await f.bootstrap(admin); await f.bootstrap(alice); await f.bootstrap(bob);
  await f.profile(alice, 'B124001');
  f.db.sqlite.prepare("INSERT INTO bills VALUES (?, ?, ?, ?)").run(alice.userId, '2026-11', 3200, 'pending');
  assert.deepEqual((await f.request(alice, 'state')).data.bills, []);
  for (const meal of [0,1,2]) {
    await f.request(alice, 'bookings', 'POST', { date: today, meal, status: 'booked' });
  }
  assert.deepEqual((await f.request(alice, 'state')).data.bills, []);
  for (const [meal, amount] of [[0,30],[1,45],[2,40]]) {
    const attended = await f.request(alice, 'attendance', 'POST', { date: today, meal, amount: 1 });
    assert.equal(attended.status, 200);
    assert.deepEqual(attended.data.charge, { month: '2026-11', meal, amount });
  }
  assert.equal((await f.request(alice, 'attendance', 'POST', { date: today, meal: 0 })).status, 409);
  const state = (await f.request(alice, 'state')).data;
  assert.deepEqual(state.bills, [{ month: '2026-11', amount: 115, status: 'pending', mealCounts: [1,1,1] }]);
  assert.deepEqual((await f.request(bob, 'state')).data.bills, []);
  const report = (await f.request(admin, 'admin/overview')).data;
  assert.equal(report.bills.length, 1); assert.equal(report.bills[0].amount, 115);
  assert.equal(report.bills[0].student_id, alice.userId);
  assert.equal((await f.request(admin, 'admin/bills', 'POST', { month: '2026-11', amount: 3200 })).status, 404);
});

test('monthly totals group by meal date and exclude skipped or unattended meals', async t => {
  const f = fixture(t); await f.bootstrap(alice); await f.profile(alice, 'B124001');
  const book = f.db.sqlite.prepare('INSERT INTO bookings VALUES (?,?,?,?,?)');
  const attend = f.db.sqlite.prepare('INSERT INTO attendance VALUES (?,?,?,?)');
  for (const [date,meal,status,attended] of [['2026-10-31',1,'booked',true],['2026-11-01',0,'booked',true],['2026-11-02',0,'booked',true],['2026-11-03',2,'skipped',false],['2026-11-04',1,'booked',false]]) {
    book.run(alice.userId,date,meal,status,'now');
    if (attended) attend.run(alice.userId,date,meal,'now');
  }
  assert.deepEqual((await f.request(alice, 'state')).data.bills, [
    { month:'2026-11', amount:60, status:'pending', mealCounts:[2,0,0] },
    { month:'2026-10', amount:45, status:'pending', mealCounts:[0,1,0] },
  ]);
});

test('shared menus survive bootstrap and students cannot edit them', async t => {
  const f = fixture(t); await f.bootstrap(admin); await f.bootstrap(alice);
  const update = { weekday: 3, meal: 1, description: 'Special vegetable thali & curd', diet: 'Vegetarian' };
  assert.equal((await f.request(alice, 'admin/menu', 'PATCH', update)).status, 403);
  assert.equal((await f.request(admin, 'admin/menu', 'PATCH', update)).status, 200);
  const state = (await f.bootstrap(alice)).data;
  assert.equal(state.menus.find(item => item.weekday === 3 && item.meal === 1).description, update.description);
});

test('feedback and notification features are removed from state and routes', async t => {
  const f = fixture(t); await f.bootstrap(admin); await f.bootstrap(alice);
  for (const [identity,path,method,data] of [[alice,'feedback','POST',{category:'Food quality',rating:4,message:'Test feedback message'}],[admin,'admin/feedback','PATCH',{id:'test',status:'reviewed'}],[admin,'admin/notices','POST',{title:'Test notice',body:'A test announcement'}],[admin,'admin/notices','DELETE',{id:'welcome'}]]) {
    assert.equal((await f.request(identity,path,method,data)).status, 404);
  }
  const state = (await f.request(alice,'state')).data;
  assert.equal('feedback' in state,false); assert.equal('notices' in state,false);
  const report = (await f.request(admin,'admin/overview')).data;
  assert.equal('feedback' in report,false); assert.equal('openFeedback' in report.counts,false);
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
  const f = fixture(t); await f.bootstrap(alice); await f.profile(alice, 'B124001');
  assert.equal((await f.request(alice, 'bookings', 'POST', { status: 'a'.repeat(17000) })).status, 413);
  assert.throws(() => f.db.sqlite.prepare('INSERT INTO attendance VALUES (?,?,?,?)').run('nonexistent', today, 0, 'now'), /FOREIGN KEY/);
  assert.throws(() => f.db.sqlite.prepare('UPDATE students SET role=? WHERE id=?').run('superuser', alice.userId), /CHECK constraint/);
});
