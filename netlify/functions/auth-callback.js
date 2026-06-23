const { createClient } = require('@supabase/supabase-js');

exports.handler = async function (event) {
  const { code, state, error } = event.queryStringParameters || {};

  // EVE returned an error
  if (error) {
    return redirect('/index.html?login=error');
  }

  if (!code) {
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
        redirect_uri: 'https://curious-chaja-a3235b.netlify.app/callback.html',
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

  // ── 5. Set session cookie & redirect back to origin page ───────────────────
  const session = JSON.stringify({ characterId, characterName, corpId, allianceId });
  const encoded = encodeURIComponent(Buffer.from(session).toString('base64'));

  // Use state as return URL if it looks safe, otherwise fall back to index
  let returnUrl = '/index.html?login=success';
  try {
    if (state) {
      const decoded = decodeURIComponent(state);
      if (decoded.startsWith('/') || decoded.startsWith('https://curious-chaja-a3235b.netlify.app')) {
        returnUrl = decoded;
      }
    }
  } catch (e) { /* ignore bad state */ }

  return {
    statusCode: 302,
    headers: {
      Location: returnUrl,
      'Set-Cookie': `pilotrep_session=${encoded}; Path=/; HttpOnly; SameSite=Lax`,
    },
    body: '',
  };
};

function redirect(url) {
  return { statusCode: 302, headers: { Location: url }, body: '' };
}
