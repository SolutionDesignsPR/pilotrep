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
      const esiUrl = `https://esi.evetech.net/v2/search/?categories=character,corporation,alliance&search=${encodeURIComponent(query)}&strict=false&language=en`;
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
      if
