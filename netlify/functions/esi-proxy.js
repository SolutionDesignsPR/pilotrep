const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Refresh an expired EVE SSO access token using the stored refresh_token.
// Returns { accessToken, refreshToken, accessTokenExpiresAt } on success, or null
// if the refresh itself fails (dead/revoked refresh token, network error, etc).
// Per CCP's rotation behavior, the refresh_token returned here MUST replace the
// old one — it may differ from the one that was sent.
async function refreshAccessToken(refreshToken) {
  try {
    const clientId     = process.env.EVE_CLIENT_ID;
    const clientSecret = process.env.EVE_CLIENT_SECRET;
    const credentials  = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

    const tokenRes = await fetch('https://login.eveonline.com/v2/oauth/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Host: 'login.eveonline.com',
      },
      body: new URLSearchParams({
        grant_type:    'refresh_token',
        refresh_token: refreshToken,
      }),
    });
    if (!tokenRes.ok) {
      console.warn('Token refresh failed:', await tokenRes.text());
      return null;
    }
    const tokenData = await tokenRes.json();
    return {
      accessToken:          tokenData.access_token,
      refreshToken:         tokenData.refresh_token,
      accessTokenExpiresAt: Date.now() + (tokenData.expires_in || 1200) * 1000,
    };
  } catch (err) {
    console.warn('Token refresh error (non-fatal):', err);
    return null;
  }
}

// If we minted a fresh token this request, forward the updated session cookie
// so the browser's stored cookie stays in sync with what CCP issued.
function withRefreshedCookie(headers, refreshedCookie) {
  if (!refreshedCookie) return headers;
  return {
    ...headers,
    'Set-Cookie': `pilotrep_session=${refreshedCookie}; Path=/; HttpOnly; SameSite=Lax; Max-Age=7200`,
  };
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json'
  };
  try {
    const { action, query, id, type, limit: limitParam } = event.queryStringParameters || {};

    // ── SEARCH ──────────────────────────────────────────────────────────────
    if (action === 'search') {
      if (!query || query.length < 3) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Query must be at least 3 characters' }) };
      }
      // Dropdown requests default to 10 (fast/snappy); search.html asks for more.
      // Clamped to 100 as a sane upper bound against abuse.
      const limit = Math.max(1, Math.min(100, parseInt(limitParam, 10) || 10));

      // Try authenticated search first (requires logged-in user's token via cookie)
      const cookieHeader = event.headers.cookie || '';
      const match = cookieHeader.match(/pilotrep_session=([^;]+)/);
      let accessToken = null;
      let session = null;
      let refreshedCookie = null; // set if we mint a new token; forwarded via Set-Cookie
      if (match) {
        try {
          session = JSON.parse(Buffer.from(match[1], 'base64').toString('utf8'));
          accessToken = session.accessToken || null;

          // Access tokens live ~20 min; the 8hr site session outlives that easily.
          // If it's expired (with a 60s buffer) and we have a refresh token, mint a new one.
          const isExpired = session.accessTokenExpiresAt && Date.now() > (session.accessTokenExpiresAt - 60000);
          if (isExpired && session.refreshToken) {
            const refreshed = await refreshAccessToken(session.refreshToken);
            if (refreshed) {
              accessToken = refreshed.accessToken;
              session.accessToken          = refreshed.accessToken;
              session.refreshToken         = refreshed.refreshToken;
              session.accessTokenExpiresAt = refreshed.accessTokenExpiresAt;
              refreshedCookie = Buffer.from(JSON.stringify(session)).toString('base64');
            } else {
              // Refresh token itself is dead/revoked — fail gracefully into the
              // unauthenticated fallback below rather than erroring. Do NOT touch
              // the 8hr site session cookie; that's a separate, unrelated concern.
              accessToken = null;
            }
          }
        } catch (_) {}
      }

      if (accessToken && session && session.characterId) {
        // Authenticated ESI search — supports partial name matching
        const esiUrl = `https://esi.evetech.net/latest/characters/${session.characterId}/search/?categories=character,corporation,alliance&search=${encodeURIComponent(query)}&strict=false&datasource=tranquility`;
        const searchRes = await fetch(esiUrl, {
          headers: { Authorization: `Bearer ${accessToken}` }
        });
        if (searchRes.ok) {
          const searchData = await searchRes.json();
          const allIds = [
            ...(searchData.character   || []).slice(0, Math.max(50, limit)),
            ...(searchData.corporation || []).slice(0, Math.max(50, limit)),
            ...(searchData.alliance    || []).slice(0, Math.max(50, limit))
          ];
          if (allIds.length === 0) {
            return { statusCode: 200, headers: withRefreshedCookie(headers, refreshedCookie), body: JSON.stringify({ mode: 'authenticated', characters: [], corporations: [], alliances: [] }) };
          }
          const namesRes = await fetch('https://esi.evetech.net/latest/universe/names/?datasource=tranquility', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(allIds)
          });
          if (namesRes.ok) {
            const namesData = await namesRes.json();
            const byName = (a, b) => a.name.localeCompare(b.name);
            const matchesQuery = n => n.name.toLowerCase().includes(query.toLowerCase());
            return {
              statusCode: 200,
              headers: withRefreshedCookie(headers, refreshedCookie),
              body: JSON.stringify({
                mode:         'authenticated',
                characters:   namesData.filter(n => n.category === 'character').filter(matchesQuery).sort(byName).slice(0, limit),
                corporations: namesData.filter(n => n.category === 'corporation').filter(matchesQuery).sort(byName).slice(0, limit),
                alliances:    namesData.filter(n => n.category === 'alliance').filter(matchesQuery).sort(byName).slice(0, limit)
              })
            };
          }
        }
      }

      // Community search — unauthenticated, substring-match against pilots/corps/alliances
      // that already have at least one rep on PilotRep. Tries this before falling back
      // to ESI's exact-match-only endpoint, since it supports real predictive search.
      try {
        const { data: repMatches, error: repMatchError } = await supabase
          .from('reps')
          .select('target_id, target_type, target_name')
          .not('target_name', 'is', null)
          .ilike('target_name', `%${query}%`)
          .limit(Math.max(150, limit * 20));

        if (!repMatchError && repMatches && repMatches.length > 0) {
          const byName = (a, b) => a.name.localeCompare(b.name);
          const byType = (t) => {
            const seenIds = new Set();
            const out = [];
            for (const r of repMatches) {
              if (r.target_type !== t) continue;
              if (seenIds.has(r.target_id)) continue;
              seenIds.add(r.target_id);
              out.push({ id: Number(r.target_id), name: r.target_name });
            }
            return out.sort(byName).slice(0, limit);
          };

          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
              mode:         'community',
              characters:   byType('pilot'),
              corporations: byType('corporation'),
              alliances:    byType('alliance')
            })
          };
        }
      } catch (err) {
        console.warn('Community search error (non-fatal, falling back to ESI):', err);
      }

      // Fallback — unauthenticated exact-name match via /universe/ids/
      const idsRes = await fetch('https://esi.evetech.net/latest/universe/ids/?datasource=tranquility&language=en', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([query])
      });
      if (!idsRes.ok) throw new Error(`ESI universe/ids failed: ${idsRes.status}`);
      const idsData = await idsRes.json();
      const byName = (a, b) => a.name.localeCompare(b.name);
      const characters   = (idsData.characters   || []).slice(0, limit).sort(byName);
      const corporations = (idsData.corporations  || []).slice(0, limit).sort(byName);
      const alliances    = (idsData.alliances     || []).slice(0, limit).sort(byName);
      return { statusCode: 200, headers, body: JSON.stringify({ mode: 'fallback', characters, corporations, alliances }) };
    }

    // ── CHARACTER LOOKUP ─────────────────────────────────────────────────────
    if (action === 'character') {
      if (!id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing id' }) };
      const charRes = await fetch(`https://esi.evetech.net/latest/characters/${id}/?datasource=tranquility`);
      if (!charRes.ok) throw new Error(`ESI character failed: ${charRes.status}`);
      const char = await charRes.json();
      const idsToResolve = [char.corporation_id];
      if (char.alliance_id) idsToResolve.push(char.alliance_id);
      const namesRes = await fetch('https://esi.evetech.net/latest/universe/names/?datasource=tranquility', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(idsToResolve)
      });
      const names = namesRes.ok ? await namesRes.json() : [];
      const corpName     = names.find(n => n.id === char.corporation_id)?.name || '';
      const allianceName = char.alliance_id ? names.find(n => n.id === char.alliance_id)?.name || '' : '';
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          id:               Number(id),
          name:             char.name,
          security_status:  parseFloat((char.security_status || 0).toFixed(1)),
          corporation_id:   char.corporation_id,
          corporation_name: corpName,
          alliance_id:      char.alliance_id || null,
          alliance_name:    allianceName,
          birthday:         char.birthday || null,
          portrait:         `https://images.evetech.net/characters/${id}/portrait?size=256`
        })
      };
    }

    // ── CORPORATION LOOKUP ───────────────────────────────────────────────────
    if (action === 'corporation') {
      if (!id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing id' }) };
      const corpRes = await fetch(`https://esi.evetech.net/latest/corporations/${id}/?datasource=tranquility`);
      if (!corpRes.ok) throw new Error(`ESI corporation failed: ${corpRes.status}`);
      const corp = await corpRes.json();
      const logoUrl = `https://images.evetech.net/corporations/${id}/logo?size=256`;

      // Alliance name + ticker — fetched directly from the alliance endpoint (gives both in one call)
      let allianceName = '';
      let allianceTicker = '';
      if (corp.alliance_id) {
        try {
          const allianceRes = await fetch(`https://esi.evetech.net/latest/alliances/${corp.alliance_id}/?datasource=tranquility`);
          if (allianceRes.ok) {
            const alliance = await allianceRes.json();
            allianceName = alliance.name || '';
            allianceTicker = alliance.ticker || '';
          }
        } catch (_) { /* non-fatal — falls back to blank alliance info */ }
      }

      // CEO name — resolved via universe/names (public, no auth required)
      let ceoName = '';
      if (corp.ceo_id) {
        try {
          const namesRes = await fetch('https://esi.evetech.net/latest/universe/names/?datasource=tranquility', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify([corp.ceo_id])
          });
          if (namesRes.ok) {
            const names = await namesRes.json();
            ceoName = names.find(n => n.id === corp.ceo_id)?.name || '';
          }
        } catch (_) { /* non-fatal — falls back to blank CEO name */ }
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          id:              Number(id),
          name:            corp.name,
          ticker:          corp.ticker,
          member_count:    corp.member_count,
          alliance_id:     corp.alliance_id || null,
          alliance_name:   allianceName,
          alliance_ticker: allianceTicker,
          ceo_id:          corp.ceo_id || null,
          ceo_name:        ceoName,
          date_founded:    corp.date_founded || null,
          logo:            logoUrl
        })
      };
    }

    // ── ALLIANCE LOOKUP ──────────────────────────────────────────────────────
    if (action === 'alliance') {
      if (!id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing id' }) };
      const allianceRes = await fetch(`https://esi.evetech.net/latest/alliances/${id}/?datasource=tranquility`);
      if (!allianceRes.ok) throw new Error(`ESI alliance failed: ${allianceRes.status}`);
      const alliance = await allianceRes.json();
      const logoUrl = `https://images.evetech.net/alliances/${id}/logo?size=256`;

      // Executor corp name — one extra ESI call, cheap. (Member count deliberately
      // omitted: ESI has no direct alliance member-count field; getting an accurate
      // total would mean fetching every member corp individually, which is too slow
      // for a page load. Parked per Clint's decision, July 2026.)
      let executorName = '';
      if (alliance.executor_corporation_id) {
        try {
          const execRes = await fetch(`https://esi.evetech.net/latest/corporations/${alliance.executor_corporation_id}/?datasource=tranquility`);
          if (execRes.ok) {
            const execCorp = await execRes.json();
            executorName = execCorp.name || '';
          }
        } catch (_) { /* non-fatal — falls back to blank executor */ }
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          id:            Number(id),
          name:          alliance.name,
          ticker:        alliance.ticker,
          logo:          logoUrl,
          executor_name: executorName,
          executor_id:   alliance.executor_corporation_id || null,
          date_founded:  alliance.date_founded || null
        })
      };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid action' }) };

  } catch (err) {
    console.error('ESI proxy error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'ESI request failed', detail: err.message }) };
  }
};
