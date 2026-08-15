exports.handler = async function (event) {
  const clientId = process.env.EVE_CLIENT_ID;

  const origin = event.queryStringParameters?.origin || '/index.html';
  const nonce  = Math.random().toString(36).substring(2, 15);
  const state  = Buffer.from(JSON.stringify({ nonce, origin })).toString('base64');

  // ⚠️ Must match the Callback URL registered on the EVE developer app EXACTLY,
  // and the redirect_uri sent during token exchange in auth-callback.js.
  const callbackUrl = 'https://pilotrep.com/.netlify/functions/auth-callback';

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
