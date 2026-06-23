exports.handler = async function (event) {
  const clientId    = process.env.EVE_CLIENT_ID;
  const callbackUrl = 'https://curious-chaja-a3235b.netlify.app/callback.html';

  // Use the return URL passed from the page as state, fallback to index
  const returnUrl = (event.queryStringParameters && event.queryStringParameters.state)
    ? event.queryStringParameters.state
    : '/index.html';

  const params = new URLSearchParams({
    response_type: 'code',
    redirect_uri:  callbackUrl,
    client_id:     clientId,
    state:         returnUrl,
  });

  const eveAuthUrl = `https://login.eveonline.com/v2/oauth/authorize?${params.toString()}`;

  return {
    statusCode: 302,
    headers: {
      Location: eveAuthUrl,
    },
    body: '',
  };
};
