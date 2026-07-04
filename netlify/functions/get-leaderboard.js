const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Grade index to letter mapping (13-point scale) — kept in sync with get-reps.js
const GRADE_TABLE = [
  { index: 0,  grade: 'F',  tier: 'neg',     html: 'F'  },
  { index: 1,  grade: 'D−', tier: 'neg',     html: 'D<span class="modifier">−</span>' },
  { index: 2,  grade: 'D',  tier: 'neg',     html: 'D'  },
  { index: 3,  grade: 'D+', tier: 'neg',     html: 'D<span class="modifier">+</span>' },
  { index: 4,  grade: 'C−', tier: 'neutral', html: 'C<span class="modifier">−</span>' },
  { index: 5,  grade: 'C',  tier: 'neutral', html: 'C'  },
  { index: 6,  grade: 'C+', tier: 'neutral', html: 'C<span class="modifier">+</span>' },
  { index: 7,  grade: 'B−', tier: 'neutral', html: 'B<span class="modifier">−</span>' },
  { index: 8,  grade: 'B',  tier: 'neutral', html: 'B'  },
  { index: 9,  grade: 'B+', tier: 'neutral', html: 'B<span class="modifier">+</span>' },
  { index: 10, grade: 'A−', tier: 'pos',     html: 'A<span class="modifier">−</span>' },
  { index: 11, grade: 'A',  tier: 'pos',     html: 'A'  },
  { index: 12, grade: 'A+', tier: 'pos',     html: 'A<span class="modifier">+</span>' },
];

// Maps a grade letter (e.g. "B−", "A+", "C") to its CSS class suffix (e.g. "Bm", "Ap", "C")
function gradeClassSuffix(grade) {
  if (!grade) return '';
  if (grade.endsWith('+')) return grade[0] + 'p';
  if (grade.endsWith('−') || grade.endsWith('-')) return grade[0] + 'm';
  return grade[0];
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json'
  };

  try {
    const { type = 'pilot', limit = '5' } = event.queryStringParameters || {};
    const limitNum = Math.max(1, Math.min(20, parseInt(limit, 10) || 5));

    if (!['pilot', 'corporation', 'alliance'].includes(type)) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid type' }) };
    }

    // 1. Pull lightweight rep rows for this entity type — just enough to aggregate
    const { data: reps, error } = await supabase
      .from('reps')
      .select('target_id, grade_index, created_at')
      .eq('target_type', type);

    if (error) throw new Error(error.message);

    if (!reps || reps.length === 0) {
      return { statusCode: 200, headers, body: JSON.stringify({ mostReviewed: [], recentlyReviewed: [] }) };
    }

    // 2. Aggregate per target_id: rep count, average grade index, most recent timestamp
    const byTarget = {};
    for (const r of reps) {
      const key = r.target_id;
      if (!byTarget[key]) byTarget[key] = { id: key, count: 0, sumIndex: 0, mostRecent: r.created_at };
      const agg = byTarget[key];
      agg.count += 1;
      agg.sumIndex += r.grade_index;
      if (new Date(r.created_at) > new Date(agg.mostRecent)) agg.mostRecent = r.created_at;
    }

    const entries = Object.values(byTarget).map(agg => {
      const avgIndex = agg.sumIndex / agg.count;
      const roundedIndex = Math.max(0, Math.min(12, Math.round(avgIndex)));
      const gradeEntry = GRADE_TABLE[roundedIndex];
      return {
        id:          agg.id,
        repCount:    agg.count,
        mostRecent:  agg.mostRecent,
        grade:       gradeEntry.grade,
        gradeClass:  gradeClassSuffix(gradeEntry.grade),
      };
    });

    // 3. Build the two leaderboards off the same aggregate
    const mostReviewed = [...entries].sort((a, b) => b.repCount - a.repCount).slice(0, limitNum);
    const recentlyReviewed = [...entries]
      .sort((a, b) => new Date(b.mostRecent) - new Date(a.mostRecent))
      .slice(0, limitNum);

    // 4. Resolve name/corp/portrait via ESI — only for the IDs actually needed
    const neededIds = [...new Set([...mostReviewed, ...recentlyReviewed].map(e => e.id))];
    const details = await Promise.all(neededIds.map(id => resolveEntity(type, id)));
    const byId = Object.fromEntries(details.map(d => [d.id, d]));

    const attach = list => list.map(e => ({ ...e, ...byId[e.id] }));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        mostReviewed:     attach(mostReviewed),
        recentlyReviewed: attach(recentlyReviewed),
      })
    };

  } catch (err) {
    console.error('get-leaderboard error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to fetch leaderboard', detail: err.message }) };
  }
};

// Resolves display name, subtext (corp/ticker), and portrait/logo URL for one entity via public ESI.
// Failures are non-fatal — the entity just falls back to a generic label rather than breaking the list.
async function resolveEntity(type, id) {
  try {
    if (type === 'pilot') {
      const charRes = await fetch(`https://esi.evetech.net/latest/characters/${id}/?datasource=tranquility`);
      if (!charRes.ok) throw new Error('char lookup failed');
      const char = await charRes.json();
      let corpName = '';
      if (char.corporation_id) {
        const namesRes = await fetch('https://esi.evetech.net/latest/universe/names/?datasource=tranquility', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify([char.corporation_id])
        });
        if (namesRes.ok) {
          const names = await namesRes.json();
          corpName = names[0]?.name || '';
        }
      }
      return { id, name: char.name || 'Unknown Pilot', subtext: corpName, portrait: `https://images.evetech.net/characters/${id}/portrait?size=64` };
    }

    if (type === 'corporation') {
      const corpRes = await fetch(`https://esi.evetech.net/latest/corporations/${id}/?datasource=tranquility`);
      if (!corpRes.ok) throw new Error('corp lookup failed');
      const corp = await corpRes.json();
      return { id, name: corp.name || 'Unknown Corporation', subtext: corp.ticker ? `[${corp.ticker}]` : '', portrait: `https://images.evetech.net/corporations/${id}/logo?size=64` };
    }

    // alliance
    const allianceRes = await fetch(`https://esi.evetech.net/latest/alliances/${id}/?datasource=tranquility`);
    if (!allianceRes.ok) throw new Error('alliance lookup failed');
    const alliance = await allianceRes.json();
    return { id, name: alliance.name || 'Unknown Alliance', subtext: alliance.ticker ? `[${alliance.ticker}]` : '', portrait: `https://images.evetech.net/alliances/${id}/logo?size=64` };

  } catch (err) {
    console.warn(`resolveEntity failed for ${type} ${id} (non-fatal):`, err.message);
    return { id, name: 'Unknown', subtext: '', portrait: '' };
  }
}
