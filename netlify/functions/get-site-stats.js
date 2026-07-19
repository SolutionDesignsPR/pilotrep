const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json'
  };

  try {
    // head:true returns just the exact row count (Postgres COUNT(*)) — no rows are
    // transferred, so this stays cheap even once totals climb into the millions.
    const [totalRepsRes, totalCommentsRes] = await Promise.all([
      supabase.from('reps').select('id', { count: 'exact', head: true }),
      supabase.from('reps').select('id', { count: 'exact', head: true }).not('comment', 'is', null)
    ]);

    if (totalRepsRes.error) throw new Error(totalRepsRes.error.message);
    if (totalCommentsRes.error) throw new Error(totalCommentsRes.error.message);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        totalReps:     totalRepsRes.count || 0,
        totalComments: totalCommentsRes.count || 0
      })
    };

  } catch (err) {
    console.error('get-site-stats error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to fetch site stats', detail: err.message }) };
  }
};
