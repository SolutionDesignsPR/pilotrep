exports.handler = async function (event) {
  const cookieHeader = event.headers.cookie || '';
  const match = cookieHeader.match(/pilotrep_session=([^;]+)/);

  if (!match) {
    return json({ loggedIn: false });
  }

  try {
    const decoded = Buffer.from(decodeURIComponent(match[1]), 'base64').toString('utf8');
    const session = JSON.parse(decoded);
    return json({ loggedIn: true, ...session });
  } catch {
    return json({ loggedIn: false });
  }
};

function json(data) {
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
    body: JSON.stringify(data),
  };
}
