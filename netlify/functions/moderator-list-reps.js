const { createClient } = require('@supabase/supabase-js');
const { verifySession } = require('./lib/session');
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const SESSION_MAX_AGE_MS = 4 * 60 * 60 * 1000; // 4 hours
const LIST_LIMIT = 150;

// Same pattern submit-rep.js hard-blocks going forward — kept here too so
// anything submitted before that filter existed still surfaces for review.
const FLAG_PATTERN = /(pedo|nonce|groomer|rapist|molest|(banged|f[u*@]cked)\s+(my|his|her)\s+(mom|mother|sister|dad|father|wife|gf|girlfriend))/i;

// Same base64-cookie pattern as the rest of the app, just a separate
// cookie name so a regular pilot session can never pass as a moderator one.
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

  const session = getModSession(event.headers.cookie);
  if (!session) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Not authenticated' }) };
  }

  try {
    const { data: reps, error } = await supabase
      .from('reps')
      .select('id, target_id, target_type, target_name, grade, comment, anonymous, reviewer_name, reviewer_id, is_corp_alliance, created_at')
      .order('created_at', { ascending: false })
      .limit(LIST_LIMIT);

    if (error) throw new Error(error.message);

    const shaped = (reps || []).map(r => ({
      id:             r.id,
      targetId:       r.target_id,
      targetType:     r.target_type,
      targetName:     r.target_name || '',
      grade:          r.grade,
      comment:        (r.comment && r.comment.trim()) ? r.comment.trim() : '',
      flagged:        !!(r.comment && FLAG_PATTERN.test(r.comment)),
      anonymous:      r.anonymous,
      reviewerName:   r.anonymous ? '(anonymous)' : (r.reviewer_name || ''),
      actualReviewerName: r.reviewer_name || '',
      reviewerId:     r.reviewer_id || null,
      isCorpAlliance: !!r.is_corp_alliance,
      createdAt:      r.created_at
    }));

    return { statusCode: 200, headers, body: JSON.stringify({ reps: shaped }) };

  } catch (err) {
    console.error('moderator-list-reps error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to fetch reps', detail: err.message }) };
  }
};
