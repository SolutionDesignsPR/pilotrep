const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Grade index to letter mapping (13-point scale) — kept in sync with get-reps.js / get-leaderboard.js
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

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json'
  };

  try {
    const { corpId } = event.queryStringParameters || {};
    if (!corpId) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing corpId' }) };
    }

    // Pull every pilot-target rep whose target belongs to this corporation
    // (target_corporation_id is captured at submission time — see submit-rep.js).
    const { data: reps, error } = await supabase
      .from('reps')
      .select('target_id, target_name, grade_index, created_at')
      .eq('target_type', 'pilot')
      .eq('target_corporation_id', String(corpId));

    if (error) throw new Error(error.message);

    if (!reps || reps.length === 0) {
      return { statusCode: 200, headers, body: JSON.stringify({ members: [] }) };
    }

    // Aggregate per pilot: rep count + simple average grade
    const byPilot = {};
    for (const r of reps) {
      const key = r.target_id;
      if (!byPilot[key]) byPilot[key] = { id: key, name: r.target_name, repCount: 0, indexSum: 0, mostRecent: r.created_at };
      const agg = byPilot[key];
      agg.repCount += 1;
      agg.indexSum += r.grade_index;
      if (new Date(r.created_at) > new Date(agg.mostRecent)) agg.mostRecent = r.created_at;
    }

    const members = Object.values(byPilot)
      .map(agg => {
        const roundedIndex = Math.max(0, Math.min(12, Math.round(agg.indexSum / agg.repCount)));
        const gradeEntry = GRADE_TABLE[roundedIndex];
        return {
          id:       agg.id,
          name:     agg.name || 'Unknown Pilot',
          repCount: agg.repCount,
          grade:    gradeEntry.grade,
          gradeHtml: gradeEntry.html,
          gradeTier: gradeEntry.tier,
          date:     formatDate(agg.mostRecent)
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    return { statusCode: 200, headers, body: JSON.stringify({ members }) };

  } catch (err) {
    console.error('get-corp-members error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to load corp members' }) };
  }
};

function formatDate(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).toUpperCase();
}
