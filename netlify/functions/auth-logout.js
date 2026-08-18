exports.handler = async () => {
  return {
    statusCode: 302,
    headers: {
      Location: '/index.html',
      'Set-Cookie': 'pilotrep_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
    },
    body: '',
  };
};
