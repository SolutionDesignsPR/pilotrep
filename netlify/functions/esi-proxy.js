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
      const esiUrl = `https://esi.evetech.net/latest/search/?categories=character,corporation,alliance&search=${encodeURIComponent(query)}&strict=false&datasource=tranquility`;
      const searchRes = await fetch(esiUrl, {
        headers: { 'User-Agent': 'PilotRep/1.0 (https://pilotrep.com; contact@pilotrep.com)' }
      });
      if (!searchRes.ok) throw new Error(`ESI search failed: ${searchRes.status}`);
      const searchData = await searchRes.json();
      const allIds = [
        ...(searchData.character   || []).slice(0, 10),
        ...(searchData.corporation || []).slice(0, 10),
        ...(searchData.alliance    || []).slice(0, 10)
      ];
      if (allIds.length === 0) {
        return { statusCode: 200, headers, body: JSON.stringify({ characters: [], corporations: [], alliances: [] }) };
      }
      const namesRes = await fetch('https://esi.evetech.net/latest/universe/names/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'PilotRep/1.0 (https://pilotrep.com; contact@pilotrep.com)'
        },
        body: JSON.stringify(allIds)
      });
      if (!namesRes.ok) throw new Error(`ESI names failed: ${namesRes.status}`);
      const namesData = await namesRes.json();
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          characters:   namesData.filter(n => n.category === 'character'),
          corporations: namesData.filter(n => n.category === 'corporation'),
          alliances:    namesData.filter(n => n.category === 'alliance')
        })
      };
    }

    // ── CHARACTER LOOKUP ─────────────────────────────────────────────────────
    if (action === 'character') {
      if (!id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing id' }) };
      const [charRes, portRes] = await Promise.all([
        fetch(`https://esi.evetech.net/latest/characters/${id}/`),
        fetch(`https://esi.evetech.net/latest/characters/${id}/portrait/`)
      ]);
      if (!charRes.ok) throw new Error(`ESI character failed: ${charRes.status}`);
      const char = await charRes.json();
      const portrait = portRes.ok ? await portRes.json() : {};
      const idsToResolve = [char.corporation_id];
      if (char.alliance_id) idsToResolve.push(char.alliance_id);
      const namesRes = await fetch('https://esi.evetech.net/latest/universe/names/', {
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
      const corpRes = await fetch(`https://esi.evetech.net/latest/corporations/${id}/`);
      if (!corpRes.ok) throw new Error(`ESI corporation failed: ${corpRes.status}`);
      const corp = await corpRes.json();
      const logoUrl =  
