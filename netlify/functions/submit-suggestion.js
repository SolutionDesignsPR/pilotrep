const { createClient } = require('@supabase/supabase-js');
const { verifySession } = require('./lib/session');
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const SESSION_MAX_AGE_MS = 2 * 60 * 60 * 1000; // 2 hours

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

  // 2. Parse body
  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  const { category, subject, message, 'suggestion-hp': suggestionHp } = body;

  // 2b. Honeypot — hidden field, real users never fill it. Silently pretend success
  // so a bot doesn't learn it was caught.
  if (suggestionHp && suggestionHp.trim() !== '') {
    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  }

  // 3. Validate required fields
  const VALID_CATEGORIES = ['General Feedback', 'Bug Report', 'Feature Request', 'Dispute A Rep', 'Report Abuse', 'Account Issue'];
  const trimmedCategory = VALID_CATEGORIES.includes(category) ? category : 'General Feedback';
  const trimmedSubject = (subject && subject.trim()) ? subject.trim() : null;
  const trimmedMessage = (message && message.trim()) ? message.trim() : null;

  if (!trimmedSubject) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Please enter a subject.' }) };
  }
  if (!trimmedMessage) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Please enter your suggestion.' }) };
  }

  const characterId = session.characterId;
  const characterName = session.characterName;

  // 4. Enforce 1-per-day cooldown per character
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const { data: existing } = await supabase
    .from('suggestions')
    .select('id, created_at')
    .eq('character_id', characterId)
    .gte('created_at', oneDayAgo.toISOString())
    .maybeSingle();

  if (existing) {
    return {
      statusCode: 429,
      body: JSON.stringify({ error: 'You can only send one message per day. Please try again tomorrow.' })
    };
  }

  // 5. Insert suggestion
  const { error } = await supabase.from('suggestions').insert({
    character_id:   characterId,
    character_name: characterName,
    category:       trimmedCategory,
    subject:        trimmedSubject,
    message:        trimmedMessage
  });

  if (error) {
    console.error('Supabase insert error:', error);
    return { statusCode: 500, body: JSON.stringify({ error: 'Failed to send message' }) };
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ success: true })
  };
};
