const crypto = require('crypto');
const { AUTH_USER, AUTH_PASSWORD, SESSION_COOKIE_NAME, SESSION_TTL_MS } = require('../config');

const authSessions = new Map();

function authRequired() {
  return Boolean(AUTH_USER && AUTH_PASSWORD);
}

function parseCookies(header = '') {
  return header
    .split(';')
    .map(part => part.trim())
    .filter(Boolean)
    .reduce((cookies, entry) => {
      const separator = entry.indexOf('=');
      if (separator === -1) return cookies;
      const key = entry.slice(0, separator).trim();
      const value = entry.slice(separator + 1).trim();
      cookies[key] = decodeURIComponent(value);
      return cookies;
    }, {});
}

function createSession(username) {
  const token = crypto.randomBytes(24).toString('hex');
  authSessions.set(token, {
    username,
    expiresAt: Date.now() + SESSION_TTL_MS,
  });
  return token;
}

function getSession(token) {
  const session = token ? authSessions.get(token) : null;
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    authSessions.delete(token);
    return null;
  }
  return session;
}

function serializeSessionCookie(token, maxAgeMs = SESSION_TTL_MS) {
  const maxAge = Math.max(0, Math.floor(maxAgeMs / 1000));
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}

function clearSession(res, token) {
  if (token) authSessions.delete(token);
  res.setHeader('Set-Cookie', `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function getAuthenticatedSession(req) {
  if (!authRequired()) return { username: 'public' };
  const cookies = parseCookies(req.headers.cookie || '');
  const token = cookies[SESSION_COOKIE_NAME] || '';
  return getSession(token);
}

function authMiddleware(req, res, next) {
  if (!authRequired()) return next();
  const session = getAuthenticatedSession(req);
  if (session) {
    req.auth = session;
    return next();
  }
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Authentication required', authRequired: true });
  }
  return next();
}

module.exports = {
  authRequired,
  parseCookies,
  createSession,
  getSession,
  serializeSessionCookie,
  clearSession,
  getAuthenticatedSession,
  authMiddleware,
};
