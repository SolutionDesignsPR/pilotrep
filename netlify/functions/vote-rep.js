const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const SESSION_MAX_AGE_MS = 2 * 60 * 60 * 1000; // 2 hours

// Simple session cookie parser (same pattern as submit-rep.js)
function getSession(cookieHeader) {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(/pilotrep_session=([^;]+)/);
  if (!match) return null;
  try {
    const session = JSON.parse(Buffer.from(match[1], 'base64').toString('utf8'));
    if (!session.createdAt || Date.now() - session.createdAt > SESSION_MAX_AGE_MS) return null;
    return session;
  } catch {
    return null;
  }
}

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json' };

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // 1. Verify session
  const session = getSession(event.headers.cookie);
  if (!session || !session.characterId) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Not logged in' }) };
  }

  // 2. Parse body
  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  const { repId, voteType } = body;

  if (!repId) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing repId' }) };
  }
  if (voteType !== 'up' && voteType !== 'down' && voteType !== null) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid voteType' }) };
  }

  const voterCharacterId = String(session.characterId);

  try {
    // 3. Block self-votes — look up the rep's true author (works for anonymous
    // reps too, since reviewer_id is always stored server-side regardless of
    // the anonymous display flag).
    const { data: repRecord, error: repLookupError } = await supabase
      .from('reps')
      .select('reviewer_id')
      .eq('id', repId)
      .maybeSingle();
    if (repLookupError) throw new Error(repLookupError.message);
    if (!repRecord) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Rep not found' }) };
    }
    if (String(repRecord.reviewer_id) === voterCharacterId) {
      return { statusCode: 403, headers, body: JSON.stringify({ error: 'You cannot vote on your own rep' }) };
    }

    if (voteType === null) {
      // Retract vote
      const { error: delError } = await supabase
        .from('rep_votes')
        .delete()
        .eq('rep_id', repId)
        .eq('voter_character_id', voterCharacterId);
      if (delError) throw new Error(delError.message);
    } else {
      // Cast or change vote — upsert on the (rep_id, voter_character_id) unique constraint
      const { error: upsertError } = await supabase
        .from('rep_votes')
        .upsert(
          { rep_id: repId, voter_character_id: voterCharacterId, vote_type: voteType },
          { onConflict: 'rep_id,voter_character_id' }
        );
      if (upsertError) throw new Error(upsertError.message);
    }

    // Recompute authoritative counts for this rep
    const { data: votes, error: countError } = await supabase
      .from('rep_votes')
      .select('vote_type')
      .eq('rep_id', repId);
    if (countError) throw new Error(countError.message);

    const upvotes = votes.filter(v => v.vote_type === 'up').length;
    const downvotes = votes.filter(v => v.vote_type === 'down').length;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, upvotes, downvotes, userVote: voteType })
    };
  } catch (err) {
    console.error('vote-rep error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to save vote', detail: err.message }) };
  }
};
