const { createClient } = require('@supabase/supabase-js');
const { signSession, safeEqual, readCookie, SESSION_COOKIE_ATTRS } = require('./lib/session');

const REDIRECT_URI = 'https://pilotrep.com/.netlify/functions/auth-callback';

exports.handler = async function (event) {
  const { code, state, error } = event.queryStringParameters || {};

  if (error) return redirect('/index.html?login=error');
  if (!code)  return redirect('/index.html?login=error');

  // ── 0. Validate state against the nonce cookie set by auth-start ───────────
  // Without this, anyone can hand a victim a login.eveonline.com URL carrying a
  // state blob they authored. The cookie name must match auth-start.js exactly.
  const stateData = decodeState(state);
  if (!stateData) return redirect('/index.html?login=error');

  const expectedNonce = readCookie(event.headers, 'eve_nonce');
  if (!expectedNonce || !safeEqual(String(stateData.nonce || ''), expectedNonce)) {
    console.error('State nonce mismatch — possible login CSRF');
    return redirect('/index.html?login=error');
  }

  // ── 1. Exchange code for access token ──────────────────────────────────────
  const clientId     = process.env.EVE_CLIENT_ID;
  const clientSecret = process.env.EVE_CLIENT_SECRET;
  const credentials  = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  let tokenData;
  try {
    const tokenRes = await fetch('https://login.eveonline.com/v2/oauth/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Host: 'login.eveonline.com',
      },
      body: new URLSearchParams({
        grant_type:   'authorization_code',
        code:         code,
        // ⚠️ Must match auth-start.js and the EVE developer app callback EXACTLY.
        redirect_uri: REDIRECT_URI,
      }),
    });
    if (!tokenRes.ok) {
      console.error('Token exchange failed:', await tokenRes.text());
      return redirect('/index.html?login=error');
    }
    tokenData = await tokenRes.json();
  } catch (err) {
    console.error('Token fetch error:', err);
    return redirect('/index.html?login=error');
  }

  // ── 2. Read character identity from the access token JWT ───────────────────
  // Replaces the deprecated https://login.eveonline.com/oauth/verify call, which
  // CCP deprecated on 1 November 2021 and may remove at any time.
  // The token came straight from CCP over TLS in step 1, so decoding the claims
  // is sufficient here. (If a token is ever accepted from anywhere else, verify
  // its signature against https://login.eveonline.com/oauth/jwks first.)
  const claims = decodeJwtPayload(tokenData.access_token);
  if (!claims || typeof claims.sub !== 'string') {
    console.error('Could not read claims from access token');
    return redirect('/index.html?login=error');
  }

  // sub looks like "CHARACTER:EVE:2112625428"
  const subMatch = claims.sub.match(/^CHARACTER:EVE:(\d+)$/);
  if (!subMatch) {
    console.error('Unexpected sub claim:', claims.sub);
    return redirect('/index.html?login=error');
  }

  const characterId   = Number(subMatch[1]);
  const characterName = claims.name;

  // ── 3. Fetch corp & alliance from public ESI ───────────────────────────────
  let corpId = null, allianceId = null;
  try {
    const esiRes = await fetch(
      `https://esi.evetech.net/latest/characters/${characterId}/?datasource=tranquility`
    );
    if (esiRes.ok) {
      const esiData = await esiRes.json();
      corpId     = esiData.corporation_id || null;
      allianceId = esiData.alliance_id    || null;
    }
  } catch (err) {
    console.warn('ESI fetch failed (non-fatal):', err);
  }

  // ── 4. Upsert pilot into Supabase ──────────────────────────────────────────
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  // Read the pilot's last_login BEFORE we overwrite it below — this is the
  // only chance to know "since when" for the new-rep check further down.
  // A null result here just means this is their first-ever login.
  let previousLastLogin = null;
  try {
    const { data: existingPilot } = await supabase
      .from('pilots')
      .select('last_login')
      .eq('character_id', characterId)
      .maybeSingle();
    previousLastLogin = existingPilot?.last_login || null;
  } catch (err) {
    console.warn('Could not read previous last_login (non-fatal):', err);
  }

  const { error: dbError } = await supabase.from('pilots').upsert(
    {
      character_id:   characterId,
      character_name: characterName,
      corporation_id: corpId,
      alliance_id:    allianceId,
      last_login:     new Date().toISOString(),
    },
    { onConflict: 'character_id' }
  );

  if (dbError) {
    console.error('Supabase upsert error:', dbError);
    return redirect('/index.html?login=error');
  }

  // ── 4b. Has this pilot received a rep since their last login? ──────────────
  // No previousLastLogin means this is their first-ever login — in that case,
  // any rep at all (even one left before they ever logged in) counts as new.
  let hasNewRep = false;
  try {
    let repQuery = supabase
      .from('reps')
      .select('id', { count: 'exact', head: true })
      .eq('target_type', 'pilot')
      .eq('target_id', String(characterId));

    if (previousLastLogin) {
      repQuery = repQuery.gt('created_at', previousLastLogin);
    }

    const { count, error: repError } = await repQuery;
    if (repError) {
      console.warn('New-rep check failed (non-fatal):', repError);
    } else {
      hasNewRep = (count || 0) > 0;
    }
  } catch (err) {
    console.warn('New-rep check failed (non-fatal):', err);
  }

  // ── 5. Set signed session cookie ───────────────────────────────────────────
  // The payload is still readable base64, but the HMAC means it cannot be
  // edited. Unsigned, anyone could hand-craft a cookie for any character_id.
  let cookieValue;
  try {
    cookieValue = signSession({
      characterId,
      characterName,
      corpId,
      allianceId,
      accessToken:  tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      accessTokenExpiresAt: Date.now() + (tokenData.expires_in || 1200) * 1000,
      createdAt: Date.now(),
    });
  } catch (err) {
    // Almost certainly SESSION_SECRET missing from the Netlify env vars.
    console.error('Could not sign session:', err.message);
    return redirect('/index.html?login=error');
  }

  // ── 6. Work out where to send them, safely ─────────────────────────────────
  let destination = '/index.html?login=success';
  const origin = safeInternalPath(stateData.origin);
  if (origin) {
    // If the origin was the pilot's own pilot.html page (they logged in from
    // their own profile), send them to my-pilotrep.html instead.
    const ownPageMatch = origin.match(/\/pilot\.html\?id=(\d+)/);
    if (ownPageMatch && ownPageMatch[1] === String(characterId)) {
      destination = '/my-pilotrep.html?login=success';
    } else {
      const separator = origin.includes('?') ? '&' : '?';
      destination = origin + separator + 'login=success';
    }
  }

  if (hasNewRep) {
    destination += (destination.includes('?') ? '&' : '?') + 'newRep=1';
  }

  return {
    statusCode: 302,
    multiValueHeaders: {
      Location: [destination],
      'Set-Cookie': [
        `pilotrep_session=${cookieValue}; ${SESSION_COOKIE_ATTRS}`,
        // Burn the nonce so the state blob cannot be replayed.
        'eve_nonce=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
      ],
    },
    body: '',
  };
};

// ───────────────────────────── helpers ──────────────────────────────────────

function redirect(url) {
  return { statusCode: 302, headers: { Location: url }, body: '' };
}

function decodeState(state) {
  try {
    const parsed = JSON.parse(Buffer.from(state || '', 'base64').toString('utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_) {
    return null;
  }
}

function decodeJwtPayload(jwt) {
  try {
    const part = String(jwt).split('.')[1];
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
  } catch (_) {
    return null;
  }
}

// Only allow same-site relative paths. Blocks "https://evil.com",
// "//evil.com" and "/\evil.com", all of which browsers treat as off-site.
function safeInternalPath(path) {
  if (typeof path !== 'string' || path.length === 0) return null;
  if (path[0] !== '/') return null;
  if (path[1] === '/' || path[1] === '\\') return null;
  return path;
}
