exports.handler = async (event) => {
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': 'pilotrep_mod_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0',
    },
    body: JSON.stringify({ success: true })
  };
};
