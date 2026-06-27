exports.handler = async function (event) {
  const clientId = process.env.EVE_CLIENT_ID;

  const origin = event.queryStringParameters?.origin || '/index.html';
  const nonce  = Math.random().toString(36).substring(2, 15);
  const state  = Buffer.from(JSON.stringify({ nonce, origin })).toString('base64');

  const callbackUrl = 'https://curious-chaja-a3235b.netlify.app/.netlify/functions/auth-callback';

  const params = new URLSearchParams({
    response_type: 'code',
    redirect_uri:  callbackUrl,
    client_id:     clientId,
    scope:         'esi-search.search_structures.v1',
    state:         state,
  });

  return {
    statusCode: 302,
    headers: {
      Location: `https://login.eveonline.com/v2/oauth/authorize?${params.toString()}`,
      'Set-Cookie': `eve_nonce=${nonce}; Path=/; HttpOnly; SameSite=Lax`,
    },
    body: '',
  };
};
