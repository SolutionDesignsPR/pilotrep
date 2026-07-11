const { createClient } = require('@supabase/supabase-js');

exports.handler = async function (event) {
  const { code, state, error } = event.queryStringParameters || {};

  if (error) return redirect('/index.html?login=error');
  if (!code)  return redirect('/index.html?login=error');

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
        redirect_uri: 'https://curious-chaja-a3235b.netlify.app/.netlify/functions/auth-callback',
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

  // ── 2. Verify token & get character identity ───────────────────────────────
  let characterData;
  try {
    const verifyRes = await fetch('https://login.eveonline.com/oauth/verify', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    if (!verifyRes.ok) {
      console.error('Verify failed:', await verifyRes.text());
      return redirect('/index.html?login=error');
    }
    characterData = await verifyRes.json();
  } catch (err) {
    console.error('Verify fetch error:', err);
    return redirect('/index.html?login=error');
  }

  const characterId   = characterData.CharacterID;
  const characterName = characterData.CharacterName;

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

  // ── 5. Set session cookie & redirect ─────────────────────────────────────
  // Store access token + refresh token in session so esi-proxy can use them for
  // authenticated search. EVE SSO access tokens expire in ~20 min (tokenData.expires_in);
  // the refresh_token lets esi-proxy silently mint a new one without re-login.
  const session = JSON.stringify({
    characterId,
    characterName,
    corpId,
    allianceId,
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token,
    accessTokenExpiresAt: Date.now() + (tokenData.expires_in || 1200) * 1000,
    createdAt: Date.now()
  });
  const encoded = Buffer.from(session).toString('base64');

  let destination = '/index.html?login=success';
  try {
    const stateData = JSON.parse(Buffer.from(state || '', 'base64').toString('utf8'));
    if (stateData.origin) {
      const separator = stateData.origin.includes('?') ? '&' : '?';
      destination = stateData.origin + separator + 'login=success';
    }
  } catch (_) {}

  return {
    statusCode: 302,
    headers: {
      Location: destination,
      'Set-Cookie': `pilotrep_session=${encoded}; Path=/; HttpOnly; SameSite=Lax; Max-Age=7200`,
    },
    body: '',
  };
};

function redirect(url) {
  return { statusCode: 302, headers: { Location: url }, body: '' };
}
