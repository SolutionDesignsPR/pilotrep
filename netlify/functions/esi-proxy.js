exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json'
  };

  try {
    const { action, query, id, type } = event.queryStringParameters || {};

    // ── SEARCH ──────────────────────────────────────────────────────────────
    // action=search&query=fishers
    // Returns characters, corporations, alliances matching the query
    if (action === 'search') {
      if (!query || query.length < 3) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Query must be at least 3 characters' }) };
      }

      const esiUrl = `https://esi.evetech.net/latest/search/?categories=character,corporation,alliance&search=${encodeURIComponent(query)}&strict=false&language=en`;
      const searchRes = await fetch(esiUrl);
      if (!searchRes.ok) throw new Error(`ESI search failed: ${searchRes.status}`);
      const searchData = await searchRes.json();

      // searchData = { character: [id, id, ...], corporation: [id, id, ...], alliance: [id, id, ...] }
      // We need to resolve IDs to names — ESI has a bulk names endpoint
      const allIds = [
        ...(searchData.character || []).slice(0, 10),
        ...(searchData.corporation || []).slice(0, 10),
        ...(searchData.alliance || []).slice(0, 10)
      ];

      if (allIds.length === 0) {
        return { statusCode: 200, headers, body: JSON.stringify({ characters: [], corporations: [], alliances: [] }) };
      }

      const namesRes = await fetch('https://esi.evetech.net/latest/universe/names/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(allIds)
      });
      if (!namesRes.ok) throw new Error(`ESI names failed: ${namesRes.status}`);
      const namesData = await namesRes.json();

      // namesData = [{ id, name, category }, ...]
      const characters   = namesData.filter(n => n.category === 'character');
      const corporations = namesData.filter(n => n.category === 'corporation');
      const alliances    = namesData.filter(n => n.category === 'alliance');

      return { statusCode: 200, headers, body: JSON.stringify({ characters, corporations, alliances }) };
    }

    // ── CHARACTER LOOKUP ─────────────────────────────────────────────────────
    // action=character&id=12345
    // Returns full character info including portrait, corp, alliance, sec status
    if (action === 'character') {
      if (!id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing id' }) };

      const [charRes, portRes] = await Promise.all([
        fetch(`https://esi.evetech.net/latest/characters/${id}/`),
        fetch(`https://esi.evetech.net/latest/characters/${id}/portrait/`)
      ]);

      if (!charRes.ok) throw new Error(`ESI character failed: ${charRes.status}`);
      const char = await charRes.json();
      const portrait = portRes.ok ? await portRes.json() : {};

      // Resolve corp and alliance names
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
          id:             Number(id),
          name:           char.name,
          security_status: parseFloat((char.security_status || 0).toFixed(1)),
          corporation_id:  char.corporation_id,
          corporation_name: corpName,
          alliance_id:    char.alliance_id || null,
          alliance_name:  allianceName,
          portrait:       portrait.px256_url || portrait.px128_url || ''
        })
      };
    }

    // ── CORPORATION LOOKUP ───────────────────────────────────────────────────
    // action=corporation&id=12345
    if (action === 'corporation') {
      if (!id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing id' }) };

      const corpRes = await fetch(`https://esi.evetech.net/latest/corporations/${id}/`);
      if (!corpRes.ok) throw new Error(`ESI corporation failed: ${corpRes.status}`);
      const corp = await corpRes.json();

      // Get logo URL
      const logoUrl = `https://images.evetech.net/corporations/${id}/logo?size=256`;

      // Resolve alliance name if present
      let allianceName = '';
      if (corp.alliance_id) {
        const namesRes = await fetch('https://esi.evetech.net/latest/universe/names/', {
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
    // action=alliance&id=12345
    if (action === 'alliance') {
      if (!id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing id' }) };

      const allianceRes = await fetch(`https://esi.evetech.net/latest/alliances/${id}/`);
      if (!allianceRes.ok) throw new Error(`ESI alliance failed: ${allianceRes.status}`);
      const alliance = await allianceRes.json();

      const logoUrl = `https://images.evetech.net/alliances/${id}/logo?size=256`;

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          id:        Number(id),
          name:      alliance.name,
          ticker:    alliance.ticker,
          logo:      logoUrl
        })
      };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid action' }) };

  } catch (err) {
    console.error('ESI proxy error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'ESI request failed', detail: err.message }) };
  }
};
