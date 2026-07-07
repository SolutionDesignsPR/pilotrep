const { createClient } = require('@supabase/supabase-js');
const Filter = require('bad-words');
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);
const profanityFilter = new Filter();
// To exempt a specific EVE term that gets flagged as a false positive,
// add it here, e.g.: profanityFilter.removeWords('term1', 'term2');

const SESSION_MAX_AGE_MS = 8 * 60 * 60 * 1000; // 8 hours

// Simple session cookie parser
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
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // 1. Verify session
  const session = getSession(event.headers.cookie);
  if (!session || !session.characterId) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Not logged in' }) };
  }

  // 2. Parse body
  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  const { targetId, targetType, grade, gradeIndex, systemType, comment, anonymous } = body;

  // 3. Validate required fields
  if (!targetId || !targetType || !grade || gradeIndex === undefined) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing required fields' }) };
  }

  if (!['pilot', 'corporation', 'alliance'].includes(targetType)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid target type' }) };
  }

  const trimmedComment = (comment && comment.trim()) ? comment.trim() : null;
  if (trimmedComment) {
    // Normalize separator characters (underscores, hyphens, dots, etc.) to spaces so
    // "fuck_shit_ass" is treated the same as "fuck shit ass", then also run a raw
    // substring check so concatenated bypasses like "FUCKINAWESOMEGUY" are caught too.
    const normalizedComment = trimmedComment.replace(/[_\-.]+/g, ' ');
    const isProfaneSubstring = profanityFilter.list.some(word =>
      trimmedComment.toLowerCase().includes(word) || normalizedComment.toLowerCase().includes(word)
    );
    if (isProfaneSubstring || profanityFilter.isProfane(normalizedComment)) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Profanity Detected : Please Revise Your Rep' }) };
    }
  }

  const reviewerId = session.characterId;
  const reviewerName = session.characterName;

  // 4. Block self-reps (pilots only)
  if (targetType === 'pilot' && String(targetId) === String(reviewerId)) {
    return { statusCode: 403, body: JSON.stringify({ error: 'You cannot rep yourself' }) };
  }

  // 5. Enforce 6-month cooldown
  // ⚠️ TESTING MODE: cooldown disabled — remove 'false &&' before launch!
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

  const { data: existing } = await supabase
    .from('reps')
    .select('id, created_at')
    .eq('reviewer_id', reviewerId)
    .eq('target_id', String(targetId))
    .gte('created_at', sixMonthsAgo.toISOString())
    .maybeSingle();

  if (false && existing) {
    const nextEligible = new Date(existing.created_at);
    nextEligible.setMonth(nextEligible.getMonth() + 6);
    const formatted = nextEligible.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    return {
      statusCode: 429,
      body: JSON.stringify({ error: `You have already submitted a rep for this target. You can rep them again after ${formatted}.` })
    };
  }

  // 6. Insert rep
  const { error } = await supabase.from('reps').insert({
    target_id:     String(targetId),
    target_type:   targetType,
    reviewer_id:   reviewerId,
    reviewer_name: reviewerName,
    grade,
    grade_index:   gradeIndex,
    system_type:   systemType || null,
    comment:       trimmedComment,
    anonymous:     anonymous || false
  });

  if (error) {
    console.error('Supabase insert error:', error);
    return { statusCode: 500, body: JSON.stringify({ error: 'Failed to save rep' }) };
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ success: true })
  };
};
