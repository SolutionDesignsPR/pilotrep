const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let choice;
  try {
    ({ choice } = JSON.parse(event.body || '{}'));
  } catch (_) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  if (choice !== 'granted' && choice !== 'denied') {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid choice' }) };
  }

  const { error } = await supabase
    .from('cookie_consent_events')
    .insert({ choice });

  if (error) {
    console.error('log-consent-choice insert error:', error);
    return { statusCode: 500, body: JSON.stringify({ error: 'Could not log choice' }) };
  }

  return { statusCode: 200, body: JSON.stringify({ logged: true }) };
};
