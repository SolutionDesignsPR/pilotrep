    if (action === 'search') {
      if (!query || query.length < 3) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Query must be at least 3 characters' }) };
      }

      // ESI /universe/ids/ resolves names to IDs — works unauthenticated
      const idsRes = await fetch('https://esi.evetech.net/latest/universe/ids/?datasource=tranquility&language=en', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([query])
      });
      if (!idsRes.ok) throw new Error(`ESI universe/ids failed: ${idsRes.status}`);
      const idsData = await idsRes.json();

      // idsData may contain: { characters: [{id,name}], corporations: [{id,name}], alliances: [{id,name}] }
      const characters   = (idsData.characters   || []).slice(0, 10);
      const corporations = (idsData.corporations  || []).slice(0, 10);
      const alliances    = (idsData.alliances     || []).slice(0, 10);

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ characters, corporations, alliances })
      };
    }
