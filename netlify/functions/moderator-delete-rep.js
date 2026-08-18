const { createClient } = require('@supabase/supabase-js');
const { verifySession } = require('./lib/session');
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const SESSION_MAX_AGE_MS = 4 * 60 * 60 * 1000; // 4 hours

function getModSession(cookieHeader) {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(/pilotrep_mod_session=([^;]+)/);
  if (!match) return null;
  // Signature must be valid. Unsigned, anyone could set isModerator themselves
  // and bypass MODERATOR_PASSWORD entirely.
  const session = verifySession(match[1]);
  if (!session) return null;
  if (!session.isModerator) return null;
  if (!session.createdAt || Date.now() - session.createdAt > SESSION_MAX_AGE_MS) return null;
  return session;
}

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json' };

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const session = getModSession(event.headers.cookie);
  if (!session) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Not authenticated' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  const { id } = body;
  if (!id) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing rep id' }) };
  }

  try {
    // Remove associated votes first — rep_votes.rep_id has a foreign key
    // pointing at reps.id, so this has to go before the rep itself.
    const { error: votesError } = await supabase
      .from('rep_votes')
      .delete()
      .eq('rep_id', id);

    if (votesError) throw new Error(votesError.message);

    const { error: repError } = await supabase
      .from('reps')
      .delete()
      .eq('id', id);

    if (repError) throw new Error(repError.message);

    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };

  } catch (err) {
    console.error('moderator-delete-rep error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to delete rep', detail: err.message }) };
  }
};
