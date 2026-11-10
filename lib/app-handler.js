import { handleRequest } from './mess-api.js';
import { handleAuth, sessionIdentity } from './auth.js';

export function canonicalRequest(request) {
  const url = new URL(request.url);
  if (['/api', '/api/', '/api/index', '/api/index.js'].includes(url.pathname) && url.searchParams.has('__path')) {
    const path = url.searchParams.get('__path');
    if (!/^[a-zA-Z0-9/-]+$/.test(path) || path.includes('..')) return null;
    url.pathname = `/api/${path}`;
    url.searchParams.delete('__path');
    return new Request(url, request);
  }
  return request;
}

export async function handleApp(request, db, config = {}) {
  request = canonicalRequest(request);
  if (!request) return Response.json({ error: 'Invalid API path.' }, { status: 400 });
  if (new URL(request.url).pathname.startsWith('/api/auth/')) return handleAuth(request, db, config);
  // Never use client-supplied identity headers or email matching to grant access.
  const identity = await sessionIdentity(request, db);
  return handleRequest(request, db, identity);
}
