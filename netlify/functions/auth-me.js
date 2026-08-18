const { verifySession } = require('./lib/session');

const SESSION_MAX_AGE_MS = 2 * 60 * 60 * 1000; // 2 hours

exports.handler = async function (event) {
  const cookieHeader = event.headers.cookie || '';
  const match = cookieHeader.match(/pilotrep_session=([^;]+)/);
  if (!match) {
    return json({ loggedIn: false });
  }
  // Forged, edited or legacy-unsigned cookies verify to null — clear them so the
  // browser stops sending a cookie the server will never accept.
  const session = verifySession(match[1]);
  if (!session) {
    return json({ loggedIn: false }, true);
  }
  if (!session.createdAt || Date.now() - session.createdAt > SESSION_MAX_AGE_MS) {
    return json({ loggedIn: false }, true); // expired — clear the stale cookie
  }
  return json({ loggedIn: true, ...session });
};

function json(data, clearCookie) {
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  };
  if (clearCookie) {
    headers['Set-Cookie'] = 'pilotrep_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0';
  }
  return {
    statusCode: 200,
    headers,
    body: JSON.stringify(data),
  };
}
