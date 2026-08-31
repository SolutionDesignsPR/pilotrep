const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function previousMonthUTC() {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const { data: available, error: availError } = await supabase
    .from('monthly_leaderboard_snapshots')
    .select('year, month')
    .order('year', { ascending: false })
    .order('month', { ascending: false });

  if (availError) {
    console.error('get-previous-top20 available months error:', availError);
    return { statusCode: 500, body: JSON.stringify({ error: 'Could not load archive' }) };
  }

  const seen = new Set();
  const availableMonths = [];
  for (const row of available) {
    const key = `${row.year}-${row.month}`;
    if (!seen.has(key)) {
      seen.add(key);
      availableMonths.push({ year: row.year, month: row.month });
    }
  }

  const params = event.queryStringParameters || {};
  let year = parseInt(params.year, 10);
  let month = parseInt(params.month, 10);

  if (!year || !month) {
    ({ year, month } = previousMonthUTC());
  }

  const { data: rows, error: rowsError } = await supabase
    .from('monthly_leaderboard_snapshots')
    .select('rank, pilot_id, pilot_name, rep_count')
    .eq('year', year)
    .eq('month', month)
    .order('rank', { ascending: true });

  if (rowsError) {
    console.error('get-previous-top20 rows error:', rowsError);
    return { statusCode: 500, body: JSON.stringify({ error: 'Could not load leaderboard' }) };
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      selected: { year, month },
      available: availableMonths,
      rows: rows || []
    })
  };
};
