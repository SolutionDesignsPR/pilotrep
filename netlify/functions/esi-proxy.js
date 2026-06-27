exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json'
  };
  try {
    const { action, query, id, type } = event.queryStringParameters || {};

    // ── SEARCH ──────────────────────────────────────────────────────────────
    if (action === 'search') {
      if (!query || query.length < 3) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Query must be at least 3 characters' }) };
      }
      const idsRes = await fetch('https://esi.evetech.net/latest/universe/ids/?datasource=tranquility&language=en', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([query])
      });
      if (!idsRes.ok) throw new Error(`ESI universe/ids failed: ${idsRes.status}`);
      const idsData = await idsRes.json();
      const characters   = (idsData.characters   || []).slice(0, 10);
      const corporations = (idsData.corporations  || []).slice(0, 10);
      const alliances    = (idsData.alliances     || []).slice(0, 10);
      return { statusCode: 200, headers, body: JSON.stringify({ characters, corporations, alliances }) };
    }

    // ── CHARACTER LOOKUP ─────────────────────────────────────────────────────
    if (action === 'character') {
      if (!id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing id' }) };
      const [charRes, portRes] = await Promise.all([
        fetch(`https://esi.evetech.net/latest/characters/${id}/?datasource=tranquility`),
        fetch(`https://esi.evetech.net/latest/characters/${id}/portrait/?datasource=tranquility`)
      ]);
      if (!charRes.ok) throw new Error(`ESI character failed: ${charRes.status}`);
      const char = await charRes.json();
      const portrait = portRes.ok ? await portRes.json() : {};
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
          portrait:         portrait.px256_url || portrait.px128_url || ''
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
      let allianceName = '';
      if (corp.alliance_id) {
        const namesRes = await fetch('https://esi.evetech.net/latest/universe/names/?datasource=tranquility', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify([corp.alliance_id])
        });
        const names = namesRes.ok ? await namesRes.json() : [];
        allianceName = names.find(n => n.id === corp.alliance_id)?.name || '';
      }
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          id:            Number(id),
          name:          corp.name,
          ticker:        corp.ticker,
          member_count:  corp.member_count,
          alliance_id:   corp.alliance_id || null,
          alliance_name: allianceName,
          logo:          logoUrl
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
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          id:     Number(id),
          name:   alliance.name,
          ticker: alliance.ticker,
          logo:   logoUrl
        })
      };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid action' }) };

  } catch (err) {
    console.error('ESI proxy error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'ESI request failed', detail: err.message }) };
  }
};
