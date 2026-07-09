const SESSION_MAX_AGE_MS = 2 * 60 * 60 * 1000; // 2 hours

exports.handler = async function (event) {
  const cookieHeader = event.headers.cookie || '';
  const match = cookieHeader.match(/pilotrep_session=([^;]+)/);
  if (!match) {
    return json({ loggedIn: false });
  }
  try {
    const decoded = Buffer.from(match[1], 'base64').toString('utf8');
    const session = JSON.parse(decoded);
    if (!session.createdAt || Date.now() - session.createdAt > SESSION_MAX_AGE_MS) {
      return json({ loggedIn: false }, true); // expired — clear the stale cookie
    }
    return json({ loggedIn: true, ...session });
  } catch {
    return json({ loggedIn: false });
  }
};

function json(data, clearCookie) {
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  };
  if (clearCookie) {
    headers['Set-Cookie'] = 'pilotrep_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0';
  }
  return {
    statusCode: 200,
    headers,
    body: JSON.stringify(data),
  };
}
