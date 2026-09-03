const { createClient } = require('@supabase/supabase-js');
const { verifySession } = require('./lib/session');
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const SESSION_MAX_AGE_MS = 2 * 60 * 60 * 1000;

function getSession(cookieHeader) {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(/pilotrep_session=([^;]+)/);
  if (!match) return null;
  const session = verifySession(match[1]);
  if (!session) return null;
  if (!session.createdAt || Date.now() - session.createdAt > SESSION_MAX_AGE_MS) return null;
  return session;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const { data: topRows, error: topError } = await supabase
    .rpc('get_monthly_top_contributors', { result_limit: 20 });

  if (topError) {
    console.error('Supabase top contributors error:', topError);
    return { statusCode: 500, body: JSON.stringify({ error: 'Could not load leaderboard' }) };
  }

  const session = getSession(event.headers.cookie);
  const loggedIn = !!(session && session.characterId);
  let isQualified = false;

  const markedRows = topRows.map(row => {
    const isYou = loggedIn && Number(row.reviewer_id) === Number(session.characterId);
    if (isYou) isQualified = true;
    return { ...row, isYou };
  });

  return {
    statusCode: 200,
    body: JSON.stringify({ top: markedRows, loggedIn, isQualified })
  };
};
