import { emailError } from '../public/email-validation.js';
import { scrypt as scryptCallback, randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const SESSION_SECONDS = 7 * 24 * 60 * 60;
const now = () => new Date().toISOString();
const digest = value => createHash('sha256').update(value).digest('hex');
const cookieName = request => new URL(request.url).protocol === 'https:' ? '__Host-mess_session' : 'mess_session';
const statement = (db, sql, ...values) => db.prepare(sql).bind(...values);
const response = (data, status = 200, headers = {}) => Response.json(data, { status, headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', ...headers } });
const error = (status, message) => { throw Object.assign(new Error(message), { status }); };
const hashPassword = async (password, salt) => (await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })).toString('hex');
const secureEqual = (a, b) => timingSafeEqual(Buffer.from(digest(a), 'hex'), Buffer.from(digest(b), 'hex'));

function readToken(request) {
  const matches = (request.headers.get('cookie') || '').split(';').map(part => part.trim()).filter(part => part.startsWith(`${cookieName(request)}=`));
  if (matches.length !== 1) return null;
  const token = matches[0].slice(cookieName(request).length + 1);
  return /^[a-f0-9]{64}$/.test(token) ? token : null;
}
function sessionCookie(request, token, maxAge) {
  return `${cookieName(request)}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`;
}
async function requestBody(request) {
  if (request.headers.get('origin') && request.headers.get('origin') !== new URL(request.url).origin) error(403, 'Cross-origin requests are not allowed.');
  if (request.headers.get('sec-fetch-site') === 'cross-site' || request.headers.get('x-mess-request') !== '1') error(403, 'Submit this request through the application.');
  if (!request.headers.get('content-type')?.startsWith('application/json')) error(415, 'Use application/json.');
  const reader = request.body?.getReader();
  if (!reader) error(400, 'A JSON body is required.');
  const chunks = []; let total = 0;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    total += value.byteLength;
    if (total > 16384) { await reader.cancel(); error(413, 'Request is too large.'); }
    chunks.push(value);
  }
  const data = Buffer.concat(chunks);
  let parsed;
  try { parsed = JSON.parse(data.toString('utf8')); } catch { error(400, 'Invalid JSON.'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) error(400, 'A JSON object is required.');
  return parsed;
}
async function rateLimit(db, email) {
  const expires = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  const result = await statement(db, `INSERT INTO auth_attempts (attempt_key,attempts,expires_at) VALUES (?,1,?)
    ON CONFLICT(attempt_key) DO UPDATE SET attempts=CASE WHEN expires_at<=? THEN 1 ELSE attempts+1 END,
    expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END RETURNING attempts`, digest(email), expires, now(), now()).first();
  if (result.attempts > 10) error(429, 'Too many attempts for this account. Try again in 15 minutes.');
}
async function createAccount(db, email, name, password, role) {
  const id = randomUUID(), salt = randomBytes(16).toString('hex'), hash = await hashPassword(password, salt);
  await db.batch([
    statement(db, 'INSERT INTO students (id,email,name,role,created_at) VALUES (?,?,?,?,?)', id, email, name, role, now()),
    statement(db, 'INSERT INTO auth_credentials (student_id,email,password_hash,password_salt,created_at) VALUES (?,?,?,?,?)', id, email, hash, salt, now()),
  ]);
  return { id, email, name, active: 1 };
}
async function startSession(db, request, user) {
  const token = randomBytes(32).toString('hex');
  await db.batch([
    statement(db, 'DELETE FROM auth_sessions WHERE expires_at<=?', now()),
    statement(db, 'DELETE FROM auth_attempts WHERE attempt_key=? OR expires_at<=?', digest(user.email), now()),
    statement(db, 'INSERT INTO auth_sessions (token_hash,student_id,expires_at) VALUES (?,?,?)', digest(token), user.id, new Date(Date.now() + SESSION_SECONDS * 1000).toISOString()),
  ]);
  return response({ ok: true }, 200, { 'Set-Cookie': sessionCookie(request, token, SESSION_SECONDS) });
}

export async function sessionIdentity(request, db) {
  const token = readToken(request);
  if (!token) return null;
  const user = await statement(db, 'SELECT s.* FROM auth_sessions a JOIN students s ON s.id=a.student_id WHERE a.token_hash=? AND a.expires_at>?', digest(token), now()).first();
  return user ? { userId: user.id, email: user.email, displayName: user.name, user } : null;
}

export async function handleAuth(request, db, config = {}) {
  try {
    if (request.method !== 'POST') return response({ error: 'Use POST for account requests.' }, 405, { Allow: 'POST' });
    const data = await requestBody(request), path = new URL(request.url).pathname;
    if (path === '/api/auth/logout') {
      const token = readToken(request);
      if (token) await statement(db, 'DELETE FROM auth_sessions WHERE token_hash=?', digest(token)).run();
      return response({ ok: true }, 200, { 'Set-Cookie': sessionCookie(request, '', 0) });
    }
    if (!['/api/auth/login', '/api/auth/register'].includes(path)) error(404, 'Account route was not found.');
    const email = typeof data.email === 'string' ? data.email.trim().toLowerCase() : '';
    const password = typeof data.password === 'string' ? data.password : '';
    const invalidEmail = emailError(email);
    if (invalidEmail) error(400, invalidEmail);
    if (password.length < 12 || password.length > 128) error(400, 'Use a password between 12 and 128 characters.');
    await rateLimit(db, email);
    const adminEmail = (config.adminEmail || '').trim().toLowerCase();
    const existing = await statement(db, 'SELECT c.*,s.name,s.active FROM auth_credentials c JOIN students s ON s.id=c.student_id WHERE c.email=?', email).first();
    if (path === '/api/auth/register') {
      if (email === adminEmail || existing) error(409, 'This email cannot be registered. Sign in if you already have an account.');
      const name = typeof data.name === 'string' ? data.name.trim() : '';
      if (name.length < 2 || name.length > 60) error(400, 'Your name must be between 2 and 60 characters.');
      return startSession(db, request, await createAccount(db, email, name, password, 'student'));
    }
    // The reserved admin account can only be created by proving the configured secret.
    if (!existing && email === adminEmail && config.adminPassword?.length >= 12 && secureEqual(password, config.adminPassword)) {
      return startSession(db, request, await createAccount(db, email, 'Mess Administrator', password, 'admin'));
    }
    const salt = existing?.password_salt || '0'.repeat(32);
    const hash = await hashPassword(password, salt);
    if (!existing || !secureEqual(hash, existing.password_hash)) error(401, 'Email or password is incorrect.');
    if (!existing.active) error(403, 'Your account is inactive. Contact the mess administrator.');
    return startSession(db, request, { id: existing.student_id, email, name: existing.name });
  } catch (cause) {
    if (cause.status) return response({ error: cause.message }, cause.status);
    if (/UNIQUE constraint failed/.test(String(cause))) return response({ error: 'This account already exists. Please sign in.' }, 409);
    console.error('Account request failed:', cause.message);
    return response({ error: 'The account request could not be completed. Please try again.' }, 500);
  }
}
