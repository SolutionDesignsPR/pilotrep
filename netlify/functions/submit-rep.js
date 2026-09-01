const { createClient } = require('@supabase/supabase-js');
const Filter = require('bad-words');
const { verifySession } = require('./lib/session');
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);
const profanityFilter = new Filter();
// To exempt a specific EVE term that gets flagged as a false positive,
// add it here, e.g.: profanityFilter.removeWords('term1', 'term2');

const SESSION_MAX_AGE_MS = 2 * 60 * 60 * 1000; // 2 hours

// Authoritative grade set — must match INPUT_TO_NUM in pilot.html.
// Server is the source of truth; the client map is just for UI display.
const GRADE_TO_INDEX = { 'F': 0, 'D': 2, 'C': 5, 'B': 8, 'A': 11, 'A+': 12 };
const VALID_SYSTEM_TYPES = ['Highsec', 'Lowsec', 'Nullsec', 'Wormhole', 'Pochven', 'N/A'];
const COMMENT_MAX_CHARS = 30;
const COMMENT_MAX_WORDS = 5;

// Simple session cookie parser
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

  // 1. Verify session
  const session = getSession(event.headers.cookie);
  if (!session || !session.characterId) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Not logged in' }) };
  }

  // 1b. Check ban status — banned characters can still log in and browse,
  // they're just blocked from submitting new reps.
  const { data: pilotRecord, error: banLookupError } = await supabase
    .from('pilots')
    .select('banned, banned_at')
    .eq('character_id', session.characterId)
    .maybeSingle();

  // Fail closed: an unanswered lookup is not the same as "no ban on record".
  // Without this, a failed query looks identical to a clean pilot.
  if (banLookupError) {
    console.error('Supabase ban lookup error:', banLookupError);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Could not verify your account status. Please try again.' })
    };
  }

  if (pilotRecord && pilotRecord.banned) {
    const bannedAt = pilotRecord.banned_at ? new Date(pilotRecord.banned_at) : new Date();
    const reapplyDate = new Date(bannedAt);
    reapplyDate.setMonth(reapplyDate.getMonth() + 6);
    return {
      statusCode: 403,
      body: JSON.stringify({ error: 'BANNED', reapplyDate: reapplyDate.toISOString() })
    };
  }

  // 2. Parse body
  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  const { targetId, targetType, targetCorpId, targetAllianceId, targetName, grade, gradeIndex, systemType, comment, anonymous, zkillUrl } = body;

  // 3. Validate required fields
  if (!targetId || !targetType || !grade || gradeIndex === undefined) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing required fields' }) };
  }

  if (!['pilot', 'corporation', 'alliance'].includes(targetType)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid target type' }) };
  }

  // 3b. Validate grade against the authoritative set, and require gradeIndex
  // to match it exactly — the client sends both, but the server decides.
  if (!Object.prototype.hasOwnProperty.call(GRADE_TO_INDEX, grade) || GRADE_TO_INDEX[grade] !== gradeIndex) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid grade' }) };
  }

  // 3c. Validate systemType against the allowed list (optional field, but if
  // present it must be one of the real options).
  if (systemType !== undefined && systemType !== null && systemType !== '' && !VALID_SYSTEM_TYPES.includes(systemType)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid system type' }) };
  }

  const trimmedComment = (comment && comment.trim()) ? comment.trim() : null;
  if (trimmedComment) {
    // 3d. Enforce the real 5-word / 30-character limit server-side. The
    // front-end's maxlength/word-truncation is UX only — this is what
    // actually stops a bypassed or direct-POST submission.
    const wordCount = trimmedComment.split(/\s+/).filter(Boolean).length;
    if (trimmedComment.length > COMMENT_MAX_CHARS || wordCount > COMMENT_MAX_WORDS) {
      return { statusCode: 400, body: JSON.stringify({ error: `Comment must be ${COMMENT_MAX_WORDS} words / ${COMMENT_MAX_CHARS} characters or fewer` }) };
    }

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

    // 3e. Hard block on unfounded serious criminal accusations and specific
    // harassment formats. These aren't caught by the profanity filter above
    // since the words themselves (e.g. "pedophile") aren't profanity — they're
    // being weaponized as a defamatory accusation, which is a different risk
    // entirely and warrants zero tolerance rather than a moderation queue.
    const HARD_BLOCK_PATTERN = /(pedo|nonce|groomer|rapist|molest|(banged|f[u*@]cked)\s+(my|his|her)\s+(mom|mother|sister|dad|father|wife|gf|girlfriend))/i;
    if (HARD_BLOCK_PATTERN.test(normalizedComment)) {
      return { statusCode: 400, body: JSON.stringify({ error: 'That comment isn\u2019t allowed. Please revise your rep.' }) };
    }
  }

  // 3f. Validate the optional zKillboard link. Only a real kill permalink is
  // accepted — this is a free-text field otherwise, and without a strict
  // pattern it would be an easy way to plant an arbitrary (or malicious)
  // link inside a rep. Normalize to a consistent canonical form regardless
  // of what variant (http/https, www, trailing slash) was pasted in.
  const trimmedZkillUrl = (zkillUrl && zkillUrl.trim()) ? zkillUrl.trim() : null;
  let normalizedZkillUrl = null;
  if (trimmedZkillUrl) {
    const ZKILL_PATTERN = /^https?:\/\/(www\.)?zkillboard\.com\/kill\/(\d+)\/?$/i;
    const match = trimmedZkillUrl.match(ZKILL_PATTERN);
    if (!match) {
      return { statusCode: 400, body: JSON.stringify({ error: 'That doesn\u2019t look like a valid zKillboard link.' }) };
    }
    normalizedZkillUrl = `https://zkillboard.com/kill/${match[2]}/`;
  }

  const reviewerId = session.characterId;
  const reviewerName = session.characterName;

  // Corp/alliance-mate flag — reviewer's corp/alliance (captured at login) vs. the
  // target's corp/alliance (sent by the front end, already loaded from ESI on-page).
  const isCorpAlliance = !!(
    (targetCorpId && session.corpId && String(targetCorpId) === String(session.corpId)) ||
    (targetAllianceId && session.allianceId && String(targetAllianceId) === String(session.allianceId))
  );

  // 4. Block self-reps (pilots only)
  if (targetType === 'pilot' && String(targetId) === String(reviewerId)) {
    return { statusCode: 403, body: JSON.stringify({ error: 'You cannot rep yourself' }) };
  }

  // 4b. Block corp/alliance-mates from repping their own corporation or alliance
  if ((targetType === 'corporation' || targetType === 'alliance') && isCorpAlliance) {
    return { statusCode: 403, body: JSON.stringify({ error: 'You cannot rep your own Corporation or Alliance' }) };
  }

  // 5 & 6. Enforce the 6-month cooldown and insert the rep atomically.
  // A prior version checked the cooldown, then inserted, as two separate
  // calls — two near-simultaneous submissions (e.g. from two tabs/devices)
  // could both pass the check before either insert landed. This single RPC
  // does both inside one Postgres transaction, serialized per reviewer+target
  // pair, so that race window is closed.
  const { data: rpcResult, error: rpcError } = await supabase.rpc('submit_rep_atomic', {
    p_target_id: String(targetId),
    p_target_type: targetType,
    p_target_name: targetName || null,
    p_target_corporation_id: targetType === 'pilot' && targetCorpId ? String(targetCorpId) : null,
    p_reviewer_id: reviewerId,
    p_reviewer_name: reviewerName,
    p_grade: grade,
    p_grade_index: gradeIndex,
    p_system_type: systemType || null,
    p_comment: trimmedComment,
    p_anonymous: anonymous || false,
    p_is_corp_alliance: isCorpAlliance,
    p_zkill_url: normalizedZkillUrl
  });

  // Fail closed: if we can't verify eligibility, refuse the rep rather than
  // silently letting it through.
  if (rpcError) {
    console.error('Supabase submit_rep_atomic error:', rpcError);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Could not verify rep eligibility. Please try again.' })
    };
  }

  const result = Array.isArray(rpcResult) ? rpcResult[0] : rpcResult;

  if (result && result.blocked) {
    if (result.reason === 'rate_hour' || result.reason === 'rate_day') {
      return {
        statusCode: 429,
        body: JSON.stringify({ error: 'ANON_RATE_LIMIT', nextEligible: result.next_eligible })
      };
    }
    const formatted = new Date(result.next_eligible).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    return {
      statusCode: 429,
      body: JSON.stringify({ error: `You have already submitted a rep for this target. You can rep them again after ${formatted}.` })
    };
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ success: true })
  };
};

