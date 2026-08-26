// EU-27 + UK. Used only to decide whether the cookie consent banner is
// legally required for this visitor — no data is stored or logged here.
const EU_UK_COUNTRIES = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR',
  'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK',
  'SI', 'ES', 'SE', 'GB'
]);

exports.handler = async (event, context) => {
  const countryCode = context.geo && context.geo.country && context.geo.country.code;

  // Fail closed: if we can't determine the country, show the banner rather
  // than silently skipping consent for an unknown visitor.
  const requireConsent = !countryCode || EU_UK_COUNTRIES.has(countryCode);

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify({ requireConsent })
  };
};
