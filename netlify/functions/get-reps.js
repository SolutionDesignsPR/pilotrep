const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Grade index to letter mapping (13-point scale)
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
    const { id, type } = event.queryStringParameters || {};

    if (!id || !type) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing id or type' }) };
    }

    if (!['pilot', 'corporation', 'alliance'].includes(type)) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid type' }) };
    }

    // Fetch all reps for this entity
    const { data: reps, error } = await supabase
      .from('reps')
      .select('id, grade, grade_index, system_type, comment, anonymous, reviewer_name, reviewer_id, is_corp_alliance, created_at')
      .eq('target_id', String(id))
      .eq('target_type', type)
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);

    if (!reps || reps.length === 0) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          repScore:      null,
          repCount:      0,
          pilotRepsCount: 0,
          corpAllianceRepsCount: 0,
          commentCount:  0,
          averageIndex:  null,
          reps:          []
        })
      };
    }

    // Corp/alliance-mate cap — each individual corp/alliance-mate reviewer only has
    // their first 3 reps per calendar month count toward the grade. Everything beyond
    // that (from that same reviewer, that same month) is still recorded and included in
    // the transparency count below, it just doesn't move the score. This makes spamming
    // reps from a single corp/alliance mate visible (via the counter) and mathematically
    // pointless (via the cap) without silently dropping any submitted rep, and without
    // penalizing other corp/alliance mates who haven't hit their own cap.
    const MONTHLY_CAP = 3;
    const otherReps = reps.filter(r => !r.is_corp_alliance);
    const corpAllianceReps = reps.filter(r => r.is_corp_alliance);

    const seenPerReviewerMonth = {};
    const countedCorpAllianceReps = corpAllianceReps
      // oldest-first, so the *earliest* reps from each reviewer in a month are the ones that count
      .slice()
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
      .filter(r => {
        const monthKey = (r.created_at || '').slice(0, 7); // 'YYYY-MM'
        const key = `${r.reviewer_id}_${monthKey}`;
        seenPerReviewerMonth[key] = (seenPerReviewerMonth[key] || 0) + 1;
        return seenPerReviewerMonth[key] <= MONTHLY_CAP;
      });

    const scoredReps = [...otherReps, ...countedCorpAllianceReps];

    // Calculate average grade index (from scored reps only — see cap above)
    const avgIndex = scoredReps.reduce((sum, r) => sum + r.grade_index, 0) / scoredReps.length;
    const roundedIndex = Math.round(avgIndex);
    const scoreGrade = GRADE_TABLE[roundedIndex] || null;

    // Count comments (non-empty)
    const commentCount = reps.filter(r => r.comment && r.comment.trim().length > 0).length;

    // Shape reps for the front end
    const shaped = reps.map(r => {
      const gradeEntry = GRADE_TABLE.find(g => g.index === r.grade_index) || {};
      return {
        id:          r.id,
        grade:       r.grade,
        gradeIndex:  r.grade_index,
        gradeHtml:   gradeEntry.html || r.grade,
        tier:        gradeEntry.tier || 'neutral',
        system:      r.system_type || '',
        comment:     (r.comment && r.comment.trim()) ? r.comment.trim() : '',
        anonymous:   r.anonymous,
        author:      r.anonymous ? '' : (r.reviewer_name || ''),
        reviewerId:  r.anonymous ? null : (r.reviewer_id || null),
        isCorpAlliance: !!r.is_corp_alliance,
        date:        formatDate(r.created_at)
      };
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        repScore:     scoreGrade ? scoreGrade.grade : null,
        repScoreHtml: scoreGrade ? scoreGrade.html  : null,
        repScoreTier: scoreGrade ? scoreGrade.tier  : null,
        repCount:     reps.length,
        pilotRepsCount: otherReps.length,
        corpAllianceRepsCount: corpAllianceReps.length,
        commentCount,
        averageIndex: avgIndex,
        reps:         shaped
      })
    };

  } catch (err) {
    console.error('get-reps error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to fetch reps', detail: err.message }) };
  }
};

function formatDate(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).toUpperCase();
}
