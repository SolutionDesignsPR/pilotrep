const crypto = require('crypto');

exports.handler = async function (event) {
  const clientId = process.env.EVE_CLIENT_ID;

  const origin = event.queryStringParameters?.origin || '/index.html';

  // Crypto-random, not Math.random(). This nonce is the site's only CSRF
  // defence on the login flow, and Math.random() is predictable enough that a
  // determined attacker could guess it.
  const nonce  = crypto.randomBytes(24).toString('base64url');
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
      // auth-callback compares this against the nonce inside the state blob.
      // Secure + a 10-minute lifetime: a login should not take longer than that,
      // and a stale nonce lying around is just extra attack surface.
      'Set-Cookie': `eve_nonce=${nonce}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
    },
    body: '',
  };
};
