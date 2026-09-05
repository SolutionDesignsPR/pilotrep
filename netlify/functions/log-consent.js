const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// No login/session required — a visitor can accept or reject cookies
// before ever logging in, so this just needs a valid choice value.
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  const choice = body.choice;
  if (choice !== 'granted' && choice !== 'denied') {
    return { statusCode: 400, body: JSON.stringify({ error: 'choice must be "granted" or "denied"' }) };
  }

  const { error } = await supabase.from('cookie_consent_events').insert({ choice });

  if (error) {
    console.error('Supabase insert error:', error);
    return { statusCode: 500, body: JSON.stringify({ error: 'Failed to log consent event' }) };
  }

  return { statusCode: 200, body: JSON.stringify({ success: true }) };
};
