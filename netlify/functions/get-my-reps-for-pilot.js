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

    const targetId = event.queryStringParameters?.id;
    if (!targetId) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing id' }) };
    }

    const targetType = event.queryStringParameters?.type || 'pilot';
    if (!['pilot', 'corporation', 'alliance'].includes(targetType)) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid type' }) };
    }

    const { data: reps, error } = await supabase
      .from('reps')
      .select('id, grade, grade_index, system_type, comment, created_at')
      .eq('reviewer_id', session.characterId)
      .eq('target_id', String(targetId))
      .eq('target_type', targetType)
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);

    const shaped = (reps || []).map(r => {
      const gradeEntry = GRADE_TABLE.find(g => g.index === r.grade_index) || {};
      return {
        id:        r.id,
        grade:     r.grade,
        gradeHtml: gradeEntry.html || r.grade,
        tier:      gradeEntry.tier || 'neutral',
        system:    r.system_type || '',
        comment:   r.comment || '',
        date:      formatDate(r.created_at)
      };
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ reps: shaped, count: shaped.length })
    };

  } catch (err) {
    console.error('get-my-reps-for-pilot error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to fetch reps', detail: err.message }) };
  }
};
