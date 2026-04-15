const { Router } = require('express');
const {
  authRequired,
  parseCookies,
  createSession,
  serializeSessionCookie,
  clearSession,
  getAuthenticatedSession,
} = require('../middleware/auth');
const { SESSION_COOKIE_NAME, AUTH_USER, AUTH_PASSWORD } = require('../config');

const router = Router();

router.get('/status', (req, res) => {
  const session = getAuthenticatedSession(req);
  res.json({
    authEnabled: authRequired(),
    authenticated: Boolean(session) || !authRequired(),
    username: session?.username || null,
  });
});

router.post('/login', (req, res) => {
  if (!authRequired()) {
    return res.json({ ok: true, authenticated: true, username: null });
  }

  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');

  if (username !== AUTH_USER || password !== AUTH_PASSWORD) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  const token = createSession(username);
  res.setHeader('Set-Cookie', serializeSessionCookie(token));
  return res.json({ ok: true, authenticated: true, username });
});

router.post('/logout', (req, res) => {
  const cookies = parseCookies(req.headers.cookie || '');
  clearSession(res, cookies[SESSION_COOKIE_NAME] || '');
  res.json({ ok: true });
});

module.exports = router;
