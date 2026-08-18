const { signSession, safeEqual } = require('./lib/session');

const SESSION_MAX_AGE_MS = 4 * 60 * 60 * 1000; // 4 hours

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json' };

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  const { password } = body;
  const expected = process.env.MODERATOR_PASSWORD;

  if (!expected) {
    console.error('MODERATOR_PASSWORD env var is not set');
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Moderator login is not configured' }) };
  }

  // Constant-time compare — a plain !== leaks the password length and
  // position of the first wrong character via response timing.
  if (!password || !safeEqual(String(password), expected)) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Incorrect password' }) };
  }

  const encoded = signSession({
    isModerator: true,
    createdAt: Date.now()
  });

  return {
    statusCode: 200,
    headers: {
      ...headers,
      'Set-Cookie': `pilotrep_mod_session=${encoded}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_MS / 1000}`,
    },
    body: JSON.stringify({ success: true })
  };
};
