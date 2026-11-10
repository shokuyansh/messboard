/* Server-only business logic; student IDs always come from platform identity. */
export const MEALS = ['Breakfast', 'Lunch', 'Dinner'];
export const HOSTELS = ['Hostel A', 'Hostel B', 'Hostel C', 'Hostel D', 'Day scholar'];
export const CATEGORIES = ['Food quality', 'Menu suggestion', 'Hygiene & cleanliness', 'Service & timing', 'Other'];
export const DEFAULT_MENUS = [
  ['Aloo paratha, curd & tea', 'Vegetable biryani, raita & dal', 'Roti, paneer curry & rice'],
  ['Idli, sambar & coconut chutney', 'Rice, dal, mixed vegetables & salad', 'Roti, aloo gobi & dal'],
  ['Poha, banana & milk', 'Rice, rajma, vegetable fry & salad', 'Roti, matar paneer & rice'],
  ['Puri, aloo sabzi & tea', 'Rice, dalma, bhindi fry & curd', 'Roti, chana masala & rice'],
  ['Bread, omelette or sprouts & milk', 'Jeera rice, dal tadka & vegetables', 'Roti, palak paneer & salad'],
  ['Upma, chutney & tea', 'Rice, chole, aloo fry & salad', 'Vegetable pulao, dal & raita'],
  ['Dosa, sambar & chutney', 'Rice, dal, seasonal curry & curd', 'Roti, mixed vegetables & rice'],
];
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new HttpError(status, message); };
const json = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', Vary: 'Cookie' } });
const timestamp = () => new Date().toISOString();
export const campusDate = (date = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
const trimText = (value, label, min, max) => {
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) fail(400, `${label} must be between ${min} and ${max} characters.`);
  return value.trim();
};
const validMeal = value => { if (!Number.isInteger(value) || value < 0 || value > 2) fail(400, 'Choose a valid meal.'); return value; };
const validDay = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T12:00:00Z`)) || new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) !== value) fail(400, 'Choose a valid date.');
  return value;
};
const validMonth = value => {
  if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) fail(400, 'Choose a valid billing month.');
  return value;
};
const prepare = (db, sql, ...values) => db.prepare(sql).bind(...values);
const first = (db, sql, ...values) => prepare(db, sql, ...values).first();
const rows = async (db, sql, ...values) => (await prepare(db, sql, ...values).all()).results;
const logStatement = (db, id, title, detail, type = 'check') => prepare(db, 'INSERT INTO activity (id,student_id,title,detail,type,timestamp) VALUES (?,?,?,?,?,?)', crypto.randomUUID(), id, title, detail, type, timestamp());
const ensureProfile = user => { if (!user.roll) fail(409, 'Complete your student profile and roll number before using this feature.'); };
const requireAdmin = user => { if (user.role !== 'admin') fail(403, 'Administrator access is required.'); };

async function body(request) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) fail(415, 'Use application/json.');
  const reader = request.body?.getReader();
  if (!reader) fail(400, 'A JSON body is required.');
  let bytes = 0; const chunks = [];
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    bytes += value.byteLength;
    if (bytes > 16384) { await reader.cancel(); fail(413, 'Request is too large.'); }
    chunks.push(value);
  }
  const buffer = new Uint8Array(bytes); let offset = 0;
  for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength; }
  let result;
  try { result = JSON.parse(new TextDecoder().decode(buffer)); } catch { fail(400, 'Invalid JSON.'); }
  if (!result || Array.isArray(result) || typeof result !== 'object') fail(400, 'A JSON object is required.');
  return result;
}

async function bootstrap(db, identity, config, today) {
  const role = config.adminEmail && identity.email.toLowerCase() === config.adminEmail.trim().toLowerCase() ? 'admin' : 'student';
  const statements = [prepare(db, 'INSERT INTO students (id,email,name,role,created_at) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET email=excluded.email', identity.userId, identity.email, identity.displayName || identity.email, role, timestamp())];
  statements.push(prepare(db, 'INSERT OR IGNORE INTO notices (id,title,body,created_at) SELECT ?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM menus)', 'welcome', 'Welcome to Mess Hub', 'Check the weekly menu, book your meals and share your feedback. Menus and billing rates start with sample values; your administrator can update them.', timestamp()));
  DEFAULT_MENUS.forEach((day, weekday) => day.forEach((description, meal) => statements.push(prepare(db, 'INSERT OR IGNORE INTO menus (weekday,meal,description,diet,updated_at) VALUES (?,?,?,?,?)', weekday, meal, description, weekday === 4 && meal === 0 ? 'Veg / Egg' : 'Vegetarian', timestamp()))));
  await db.batch(statements);
  const user = await first(db, 'SELECT * FROM students WHERE id=?', identity.userId);
  if (!user.active) fail(403, 'Your mess account is inactive. Contact the administrator.');
  await prepare(db, 'INSERT OR IGNORE INTO bills (student_id,month,amount,status) VALUES (?,?,COALESCE((SELECT amount FROM billing_rates WHERE month=?),3200),?)', user.id, today.slice(0, 7), today.slice(0, 7), 'pending').run();
  return user;
}

async function stateFor(db, user, today) {
  const [bookingRows, attendanceRows, billRows, feedbackRows, activityRows, menuRows, noticeRows] = await Promise.all([
    rows(db, 'SELECT meal_date,meal,status FROM bookings WHERE student_id=? ORDER BY meal_date DESC', user.id),
    rows(db, 'SELECT meal_date,meal,checked_at FROM attendance WHERE student_id=?', user.id),
    rows(db, 'SELECT * FROM bills WHERE student_id=? ORDER BY month DESC', user.id),
    rows(db, 'SELECT * FROM feedback WHERE student_id=? ORDER BY created_at DESC LIMIT 100', user.id),
    rows(db, 'SELECT title,detail,type,timestamp FROM activity WHERE student_id=? ORDER BY timestamp DESC LIMIT 40', user.id),
    rows(db, 'SELECT * FROM menus ORDER BY weekday,meal'), rows(db, 'SELECT * FROM notices ORDER BY created_at DESC LIMIT 10'),
  ]);
  return {
    today, profile: { name: user.name, roll: user.roll || '', hostel: user.hostel, email: user.email, role: user.role },
    bookings: Object.fromEntries(bookingRows.map(item => [`${item.meal_date}_${item.meal}`, item.status])),
    attendance: Object.fromEntries(attendanceRows.map(item => [`${item.meal_date}_${item.meal}`, item.checked_at])),
    bills: billRows.map(item => ({ month: item.month, amount: item.amount, status: item.status, timestamp: item.paid_at, receipt: item.receipt })),
    payments: billRows.filter(item => item.status === 'simulated_paid').map(item => ({ id: item.receipt, month: item.month, amount: item.amount, timestamp: item.paid_at })),
    feedback: feedbackRows.map(item => ({ id: item.id, category: item.category, rating: item.rating, message: item.message, status: item.status, timestamp: item.created_at })),
    activity: activityRows, menus: menuRows, notices: noticeRows,
  };
}

export async function handleRequest(request, db, identity, config = {}) {
  try {
    if (!identity?.userId || !identity?.email) fail(401, 'Sign in to access your mess account.');
    if (!db) fail(503, 'The database is not configured.');
    const url = new URL(request.url), path = url.pathname.replace(/\/$/, ''), method = request.method;
    const today = config.today || campusDate();
    if (!['GET', 'HEAD'].includes(method)) {
      if (request.headers.get('origin') && request.headers.get('origin') !== url.origin) fail(403, 'Cross-origin requests are not allowed.');
      if (request.headers.get('sec-fetch-site') === 'cross-site' || request.headers.get('x-mess-request') !== '1') fail(403, 'Use the mess application to submit this request.');
    }
    if (path === '/api/bootstrap' && method === 'POST') {
      await body(request);
      return json(await stateFor(db, await bootstrap(db, identity, config, today), today));
    }
    const user = await first(db, 'SELECT * FROM students WHERE id=?', identity.userId);
    if (!user) fail(409, 'Open the workspace to set up your profile first.');
    if (!user.active) fail(403, 'Your mess account is inactive. Contact the administrator.');
    if (path === '/api/state' && method === 'GET') return json(await stateFor(db, user, today));
    if (path === '/api/profile' && method === 'PATCH') {
      const data = await body(request), name = trimText(data.name, 'Name', 2, 60), roll = trimText(data.roll, 'Roll number', 3, 20).toUpperCase();
      if (!/^[A-Z0-9-]+$/.test(roll) || !HOSTELS.includes(data.hostel)) fail(400, 'Enter a valid roll number and hostel.');
      if (await first(db, 'SELECT id FROM students WHERE roll=? AND id<>?', roll, user.id)) fail(409, 'This roll number is already in use.');
      await prepare(db, 'UPDATE students SET name=?,roll=?,hostel=? WHERE id=?', name, roll, data.hostel, user.id).run();
      return json({ ok: true });
    }
    if (path === '/api/bookings' && method === 'POST') {
      ensureProfile(user);
      const data = await body(request), date = validDay(data.date), meal = validMeal(data.meal);
      const max = new Date(`${today}T12:00:00Z`); max.setUTCDate(max.getUTCDate() + 30);
      if (date < today || date > max.toISOString().slice(0, 10)) fail(400, 'Book meals from today up to 30 days ahead.');
      if (!['booked', 'skipped'].includes(data.status)) fail(400, 'Choose booked or skipped.');
      const result = await prepare(db, `INSERT INTO bookings (student_id,meal_date,meal,status,updated_at)
        SELECT ?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM attendance WHERE student_id=? AND meal_date=? AND meal=?)
        ON CONFLICT(student_id,meal_date,meal) DO UPDATE SET status=excluded.status,updated_at=excluded.updated_at
        WHERE NOT EXISTS (SELECT 1 FROM attendance WHERE student_id=? AND meal_date=? AND meal=?)`, user.id, date, meal, data.status, timestamp(), user.id, date, meal, user.id, date, meal).run();
      if (!result.meta.changes) fail(409, 'A served meal cannot be changed.');
      await logStatement(db, user.id, `${MEALS[meal]} ${data.status}`, `${date} · Your meal plan is saved.`, data.status === 'skipped' ? 'leaf' : 'calendar').run();
      return json({ ok: true });
    }
    if (path === '/api/attendance' && method === 'POST') {
      ensureProfile(user);
      const data = await body(request), meal = validMeal(data.meal);
      if (data.date !== today) fail(400, 'Check-in is available only for today’s meals.');
      const result = await prepare(db, `INSERT OR IGNORE INTO attendance (student_id,meal_date,meal,checked_at)
        SELECT student_id,meal_date,meal,? FROM bookings WHERE student_id=? AND meal_date=? AND meal=? AND status='booked'`, timestamp(), user.id, today, meal).run();
      if (!result.meta.changes) fail(409, 'Book this meal first, or check whether you have already checked in.');
      await logStatement(db, user.id, `${MEALS[meal]} check-in complete`, `${today} · Enjoy your meal!`).run();
      return json({ ok: true });
    }
    if (path === '/api/payments/simulate' && method === 'POST') {
      ensureProfile(user);
      const data = await body(request), month = validMonth(data.month), receipt = `SIM-${crypto.randomUUID()}`;
      const result = await prepare(db, `UPDATE bills SET status='simulated_paid',paid_at=?,receipt=? WHERE student_id=? AND month=? AND status='pending'`, timestamp(), receipt, user.id, month).run();
      if (!result.meta.changes) fail(409, 'This bill does not exist or has already been settled.');
      await logStatement(db, user.id, 'Simulated payment recorded', `${month} · Receipt available.`, 'wallet').run();
      return json({ ok: true, receipt });
    }
    if (path === '/api/feedback' && method === 'POST') {
      const data = await body(request), message = trimText(data.message, 'Feedback', 10, 1500);
      if (!Number.isInteger(data.rating) || data.rating < 1 || data.rating > 5 || !CATEGORIES.includes(data.category)) fail(400, 'Choose a valid category and a rating from 1 to 5.');
      const recent = await first(db, 'SELECT COUNT(*) AS count FROM feedback WHERE student_id=? AND created_at>?', user.id, new Date(Date.now() - 3600000).toISOString());
      if (recent.count >= 10) fail(429, 'You can save up to 10 feedback entries per hour.');
      await db.batch([prepare(db, 'INSERT INTO feedback (id,student_id,category,rating,message,status,created_at) VALUES (?,?,?,?,?,?,?)', crypto.randomUUID(), user.id, data.category, data.rating, message, 'open', timestamp()), logStatement(db, user.id, 'Feedback shared', `${data.category} · ${data.rating}/5 stars`, 'message')]);
      return json({ ok: true }, 201);
    }
    if (path.startsWith('/api/admin/')) {
      requireAdmin(user);
      if (path === '/api/admin/overview' && method === 'GET') {
        const date = validDay(url.searchParams.get('date') || today);
        const [students, bookings, attendance, feedback, bills, counts] = await Promise.all([
          rows(db, 'SELECT id,name,email,roll,hostel,role,active,created_at FROM students ORDER BY created_at DESC LIMIT 500'),
          rows(db, 'SELECT b.*,s.name,s.roll FROM bookings b JOIN students s ON s.id=b.student_id WHERE b.meal_date=? ORDER BY b.meal,s.name', date),
          rows(db, 'SELECT a.*,s.name,s.roll FROM attendance a JOIN students s ON s.id=a.student_id WHERE a.meal_date=? ORDER BY a.checked_at DESC', date),
          rows(db, 'SELECT f.*,s.name,s.roll FROM feedback f JOIN students s ON s.id=f.student_id ORDER BY f.created_at DESC LIMIT 100'),
          rows(db, 'SELECT b.*,s.name,s.roll FROM bills b JOIN students s ON s.id=b.student_id ORDER BY b.month DESC,s.name LIMIT 500'),
          first(db, 'SELECT (SELECT COUNT(*) FROM students) AS students,(SELECT COUNT(*) FROM feedback WHERE status=\'open\') AS openFeedback'),
        ]);
        return json({ date, students, bookings, attendance, feedback, bills, counts });
      }
      if (path === '/api/admin/menu' && method === 'PATCH') {
        const data = await body(request), meal = validMeal(data.meal), description = trimText(data.description, 'Menu description', 5, 250), diet = trimText(data.diet, 'Diet label', 2, 25);
        if (!Number.isInteger(data.weekday) || data.weekday < 0 || data.weekday > 6) fail(400, 'Choose a weekday from 0 to 6.');
        await prepare(db, 'UPDATE menus SET description=?,diet=?,updated_at=? WHERE weekday=? AND meal=?', description, diet, timestamp(), data.weekday, meal).run();
        return json({ ok: true });
      }
      if (path === '/api/admin/notices' && method === 'POST') {
        const data = await body(request), title = trimText(data.title, 'Title', 3, 100), message = trimText(data.body, 'Notice', 10, 1000);
        await prepare(db, 'INSERT INTO notices (id,title,body,created_at) VALUES (?,?,?,?)', crypto.randomUUID(), title, message, timestamp()).run();
        return json({ ok: true }, 201);
      }
      if (path === '/api/admin/notices' && method === 'DELETE') {
        const data = await body(request), id = trimText(data.id, 'Notice ID', 1, 60);
        await prepare(db, 'DELETE FROM notices WHERE id=?', id).run();
        return json({ ok: true });
      }
      if (path === '/api/admin/feedback' && method === 'PATCH') {
        const data = await body(request), id = trimText(data.id, 'Feedback ID', 1, 60);
        if (!['open', 'reviewed'].includes(data.status)) fail(400, 'Choose a valid feedback status.');
        const result = await prepare(db, 'UPDATE feedback SET status=? WHERE id=?', data.status, id).run();
        if (!result.meta.changes) fail(404, 'Feedback was not found.');
        return json({ ok: true });
      }
      if (path === '/api/admin/students' && method === 'PATCH') {
        const data = await body(request), id = trimText(data.id, 'Student ID', 1, 200);
        if (id === user.id) fail(400, 'You cannot change your own administrative access.');
        if (!['student', 'admin'].includes(data.role) || typeof data.active !== 'boolean') fail(400, 'Choose a valid role and account status.');
        const result = await prepare(db, 'UPDATE students SET role=?,active=? WHERE id=?', data.role, data.active ? 1 : 0, id).run();
        if (!result.meta.changes) fail(404, 'Student was not found.');
        return json({ ok: true });
      }
      if (path === '/api/admin/bills' && method === 'POST') {
        const data = await body(request), month = validMonth(data.month), amount = data.amount;
        if (!Number.isInteger(amount) || amount < 0 || amount > 100000) fail(400, 'Enter a whole-rupee bill amount between 0 and 100000.');
        if (month > today.slice(0, 7)) fail(400, 'Issue bills for the current month or a past month.');
        const result = await db.batch([
          prepare(db, 'INSERT INTO billing_rates (month,amount) VALUES (?,?) ON CONFLICT(month) DO UPDATE SET amount=excluded.amount', month, amount),
          prepare(db, `INSERT INTO bills (student_id,month,amount,status) SELECT id,?,?,'pending' FROM students WHERE active=1
            ON CONFLICT(student_id,month) DO UPDATE SET amount=excluded.amount WHERE bills.status='pending'`, month, amount),
        ]);
        return json({ ok: true, updated: result[1].meta.changes });
      }
    }
    fail(404, 'API route was not found.');
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    if (/UNIQUE constraint failed: students.roll/.test(String(error))) return json({ error: 'This roll number is already in use.' }, 409);
    console.error('Mess API request failed:', error?.message || 'Unknown database error');
    return json({ error: 'The server could not complete this request. Please try again.' }, 500);
  }
}
