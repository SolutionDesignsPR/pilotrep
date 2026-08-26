const { createClient } = require('@supabase/supabase-js');
const { signSession, safeEqual } = require('./lib/session');
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const SESSION_MAX_AGE_MS = 4 * 60 * 60 * 1000; // 4 hours

// Brute-force protection — constant-time comparison alone only stops timing
// attacks, it does nothing to stop someone just scripting thousands of
// password guesses back-to-back. Locks an IP out after too many failures.
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

function getClientIp(event) {
  // Netlify sets this to the real client IP; x-forwarded-for is a fallback
  // for local/other environments and can list multiple hops, so take the first.
  const nfIp = event.headers['x-nf-client-connection-ip'];
  if (nfIp) return nfIp;
  const forwarded = event.headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return 'unknown';
}

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json' };

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const ip = getClientIp(event);

  // 0. Check lockout status for this IP before even looking at the password.
  const { data: attemptRecord, error: lookupError } = await supabase
    .from('moderator_login_attempts')
    .select('failed_count, locked_until')
    .eq('ip', ip)
    .maybeSingle();

  // Fail closed: if we can't check the lockout state, refuse rather than
  // silently allowing unlimited guesses.
  if (lookupError) {
    console.error('Supabase attempt lookup error:', lookupError);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Login temporarily unavailable. Please try again.' }) };
  }

  if (attemptRecord && attemptRecord.locked_until && new Date(attemptRecord.locked_until) > new Date()) {
    const minutesLeft = Math.ceil((new Date(attemptRecord.locked_until) - new Date()) / 60000);
    return {
      statusCode: 429,
      headers,
      body: JSON.stringify({ error: `Too many failed attempts. Try again in ${minutesLeft} minute${minutesLeft === 1 ? '' : 's'}.` })
    };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  const { password } = body;
  const expected = process.env.MODERATOR_PASSWORD;

  if (!expected) {
    console.error('MODERATOR_PASSWORD env var is not set');
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Moderator login is not configured' }) };
  }

  // Constant-time compare — a plain !== leaks the password length and
  // position of the first wrong character via response timing.
  if (!password || !safeEqual(String(password), expected)) {
    // Record the failure and lock out if this pushes the count past the limit.
    const newFailedCount = (attemptRecord ? attemptRecord.failed_count : 0) + 1;
    const lockedUntil = newFailedCount >= MAX_FAILED_ATTEMPTS
      ? new Date(Date.now() + LOCKOUT_MS).toISOString()
      : null;

    const { error: upsertError } = await supabase
      .from('moderator_login_attempts')
      .upsert(
        { ip, failed_count: lockedUntil ? 0 : newFailedCount, locked_until: lockedUntil },
        { onConflict: 'ip' }
      );
    if (upsertError) console.error('Supabase attempt upsert error:', upsertError);

    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Incorrect password' }) };
  }

  // Correct password — clear any failure history for this IP.
  if (attemptRecord) {
    const { error: clearError } = await supabase
      .from('moderator_login_attempts')
      .delete()
      .eq('ip', ip);
    if (clearError) console.error('Supabase attempt clear error:', clearError);
  }

  const encoded = signSession({
    isModerator: true,
    createdAt: Date.now()
  });

  return {
    statusCode: 200,
    headers: {
      ...headers,
      'Set-Cookie': `pilotrep_mod_session=${encoded}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_MS / 1000}`,
    },
    body: JSON.stringify({ success: true })
  };
};
