const { createClient } = require('@supabase/supabase-js');
const { verifySession } = require('./lib/session');
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const SESSION_MAX_AGE_MS = 2 * 60 * 60 * 1000; // 2 hours

// Same base64 session-cookie pattern as submit-suggestion.js / get-reps.js
function getSession(cookieHeader) {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(/pilotrep_session=([^;]+)/);
  if (!match) return null;
  // Signature must be valid — a forged or edited cookie is rejected outright.
  const session = verifySession(match[1]);
  if (!session) return null;
  if (!session.createdAt || Date.now() - session.createdAt > SESSION_MAX_AGE_MS) return null;
  return session;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const session = getSession(event.headers.cookie);
  if (!session || !session.characterId) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Not logged in' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  const optedIn = !!body.optedIn;

  const { error } = await supabase.from('notify_signups').upsert(
    {
      character_id:   session.characterId,
      character_name: session.characterName,
      opted_in:       optedIn,
      updated_at:     new Date().toISOString()
    },
    { onConflict: 'character_id' }
  );

  if (error) {
    console.error('Supabase upsert error:', error);
    return { statusCode: 500, body: JSON.stringify({ error: 'Failed to save preference' }) };
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ success: true, optedIn })
  };
};
