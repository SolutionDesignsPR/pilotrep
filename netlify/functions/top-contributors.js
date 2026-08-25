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

  let myRank = null;
  const session = getSession(event.headers.cookie);
  if (session && session.characterId) {
    const alreadyInTop = topRows.some(row => Number(row.reviewer_id) === Number(session.characterId));
    if (!alreadyInTop) {
      const { data: myRows, error: myError } = await supabase
        .rpc('get_my_monthly_rank', { p_reviewer_id: session.characterId });
      if (!myError && myRows && myRows[0]) {
        myRank = myRows[0];
      }
    }
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ top: topRows, myRank })
  };
};
