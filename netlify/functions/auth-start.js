exports.handler = async function () {
  const clientId = process.env.EVE_CLIENT_ID;
  const callbackUrl = 'https://curious-chaja-a3235b.netlify.app/callback.html';
  const state = Math.random().toString(36).substring(2, 15);

  const params = new URLSearchParams({
    response_type: 'code',
    redirect_uri: callbackUrl,
    client_id: clientId,
    state: state,
  });

  const eveAuthUrl = `https://login.eveonline.com/v2/oauth/authorize?${params.toString()}`;

  return {
    statusCode: 302,
    headers: {
      Location: eveAuthUrl,
      'Set-Cookie': `eve_state=${state}; Path=/; HttpOnly; SameSite=Lax`,
    },
    body: '',
  };
};
