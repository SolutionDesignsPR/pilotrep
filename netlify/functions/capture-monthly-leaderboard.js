const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Scheduled via netlify.toml: [functions."capture-monthly-leaderboard"] schedule = "5 0 1 * *"
// Runs at 00:05 UTC on the 1st of every month.
exports.handler = async () => {
  const now = new Date();
  // Previous month, computed in UTC so the boundary matches the RPC's UTC month bounds.
  const prevMonthDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const year = prevMonthDate.getUTCFullYear();
  const month = prevMonthDate.getUTCMonth() + 1;

  const { data: rows, error: rpcError } = await supabase
    .rpc('get_leaderboard_for_month', { p_year: year, p_month: month, result_limit: 20 });

  if (rpcError) {
    console.error('capture-monthly-leaderboard RPC error:', rpcError);
    return { statusCode: 500, body: JSON.stringify({ error: 'Could not compute leaderboard' }) };
  }

  if (!rows || rows.length === 0) {
    console.log(`capture-monthly-leaderboard: no qualifying reps for ${year}-${month}, nothing to snapshot.`);
    return { statusCode: 200, body: JSON.stringify({ inserted: 0 }) };
  }

  const snapshotRows = rows.map(row => ({
    year,
    month,
    rank: row.rank,
    pilot_id: row.reviewer_id,
    pilot_name: row.reviewer_name,
    rep_count: row.qualifying_reps,
    first_rep_at: row.first_qualifying_at
  }));

  const { error: upsertError } = await supabase
    .from('monthly_leaderboard_snapshots')
    .upsert(snapshotRows, { onConflict: 'year,month,pilot_id' });

  if (upsertError) {
    console.error('capture-monthly-leaderboard upsert error:', upsertError);
    return { statusCode: 500, body: JSON.stringify({ error: 'Could not save snapshot' }) };
  }

  console.log(`capture-monthly-leaderboard: saved ${snapshotRows.length} rows for ${year}-${month}.`);
  return { statusCode: 200, body: JSON.stringify({ inserted: snapshotRows.length }) };
};
