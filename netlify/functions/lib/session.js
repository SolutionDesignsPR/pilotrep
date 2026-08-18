// ─────────────────────────────────────────────────────────────────────────────
// PilotRep — shared session cookie signing & verification
//
// WHY THIS EXISTS
// The pilotrep_session cookie used to be plain base64. Base64 is *encoding*,
// not *authentication* — anyone could hand-craft a cookie claiming to be any
// character and the site would believe them. On a reputation platform that is
// a total authentication bypass.
//
// Now the cookie looks like:   <base64url payload>.<HMAC-SHA256 signature>
// The payload is still readable (that's fine, it holds nothing secret from the
// person it belongs to) but it cannot be *edited* without SESSION_SECRET.
//
// Requires the SESSION_SECRET environment variable in Netlify.
// ─────────────────────────────────────────────────────────────────────────────

const crypto = require('crypto');

// Sign a base64url payload string. Throws if SESSION_SECRET is missing, which
// is deliberate — a silent unsigned fallback would reopen the whole hole.
function signPayload(payload) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET is not set');
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

// Turn a session object into a signed cookie value.
function signSession(sessionObject) {
  const payload = Buffer.from(JSON.stringify(sessionObject)).toString('base64url');
  return `${payload}.${signPayload(payload)}`;
}

// Verify a signed cookie value and return the session object.
// Returns null for anything untrustworthy: forged payload, tampered signature,
// an old unsigned cookie, or a missing SESSION_SECRET. Fails closed by design —
// a rejected session just means "logged out", never "trusted anyway".
function verifySession(cookieValue) {
  if (typeof cookieValue !== 'string') return null;

  const idx = cookieValue.lastIndexOf('.');
  if (idx < 1) return null; // no signature present (e.g. a legacy cookie)

  const payload = cookieValue.slice(0, idx);
  const provided = cookieValue.slice(idx + 1);

  let expected;
  try {
    expected = signPayload(payload);
  } catch (err) {
    console.error('Session verification unavailable:', err.message);
    return null;
  }

  if (!safeEqual(provided, expected)) return null;

  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch (_) {
    return null;
  }
}

// Constant-time string comparison. A plain === leaks timing information that
// can be used to guess a signature byte by byte.
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// Pull a single named cookie out of a raw Cookie header.
function readCookie(headers, name) {
  const header = (headers && (headers.cookie || headers.Cookie)) || '';
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return rest.join('=');
  }
  return null;
}

// Shared cookie attributes, so every function issues an identical cookie.
const SESSION_COOKIE_ATTRS = 'Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=7200';

module.exports = {
  signSession,
  verifySession,
  safeEqual,
  readCookie,
  SESSION_COOKIE_ATTRS,
};
