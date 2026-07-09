const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const SESSION_MAX_AGE_MS = 2 * 60 * 60 * 1000; // 2 hours

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

const TYPE_PAGE = {
  pilot:       'pilot.html',
  corporation: 'corporation.html',
  alliance:    'alliance.html'
};

function getSession(cookieHeader) {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(/pilotrep_session=([^;]+)/);
  if (!match) return null;
  try {
    const session = JSON.parse(Buffer.from(match[1], 'base64').toString('utf8'));
    if (!session.createdAt || Date.now() - session.createdAt > SESSION_MAX_AGE_MS) return null;
    return session;
  } catch {
    return null;
  }
}

function formatDate(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).toUpperCase();
}

// ESI /universe/names/ accepts a max of 1000 ids per call — chunk defensively
async function resolveNames(ids) {
  const unique = [...new Set(ids)].filter(Boolean);
  if (unique.length === 0) return new Map();

  const chunks = [];
  for (let i = 0; i < unique.length; i += 1000) chunks.push(unique.slice(i, i + 1000));

  const byId = new Map();
  for (const chunk of chunks) {
    try {
      const res = await fetch('https://esi.evetech.net/latest/universe/names/?datasource=tranquility', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(chunk)
      });
      if (!res.ok) continue;
      const data = await res.json();
      data.forEach(n => byId.set(n.id, n.name));
    } catch (_) { /* non-fatal — falls back to blank names below */ }
  }
  return byId;
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json'
  };

  try {
    const session = getSession(event.headers.cookie);
    if (!session || !session.characterId) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Not logged in' }) };
    }

    const { data: reps, error } = await supabase
      .from('reps')
      .select('id, target_id, target_type, grade, grade_index, system_type, created_at')
      .eq('reviewer_id', session.characterId)
      .order('created_at', { ascending: false })
      .limit(150);

    if (error) throw new Error(error.message);

    const empty = { reps: { pilot: [], corporation: [], alliance: [] }, counts: { pilot: 0, corporation: 0, alliance: 0 } };
    if (!reps || reps.length === 0) {
      return { statusCode: 200, headers, body: JSON.stringify(empty) };
    }

    const namesById = await resolveNames(reps.map(r => Number(r.target_id)));

    const shaped = { pilot: [], corporation: [], alliance: [] };
    reps.forEach(r => {
      if (!TYPE_PAGE[r.target_type]) return;
      if (shaped[r.target_type].length >= 10) return;
      const gradeEntry = GRADE_TABLE.find(g => g.index === r.grade_index) || {};
      shaped[r.target_type].push({
        id:         r.id,
        targetId:   r.target_id,
        targetName: namesById.get(Number(r.target_id)) || 'Unknown',
        targetPage: TYPE_PAGE[r.target_type],
        grade:      r.grade,
        gradeHtml:  gradeEntry.html || r.grade,
        tier:       gradeEntry.tier || 'neutral',
        system:     r.system_type || '',
        date:       formatDate(r.created_at)
      });
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        reps: shaped,
        counts: {
          pilot:       shaped.pilot.length,
          corporation: shaped.corporation.length,
          alliance:    shaped.alliance.length
        }
      })
    };

  } catch (err) {
    console.error('get-my-reps error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to fetch reps', detail: err.message }) };
  }
};
