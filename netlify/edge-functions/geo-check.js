// EU-27 + UK. Used only to decide whether the cookie consent banner is
// legally required for this visitor — no data is stored or logged here.
//
// NOTE: this must be a Netlify EDGE Function (Deno runtime), not a regular
// Netlify Function. context.geo is only populated on Edge Functions — on a
// regular function it is always undefined, which silently made this always
// return requireConsent: true regardless of where the request came from.
const EU_UK_COUNTRIES = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR',
  'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK',
  'SI', 'ES', 'SE', 'GB'
]);

export default async (request, context) => {
  const countryCode = context.geo && context.geo.country && context.geo.country.code;

  // Fail closed: if we can't determine the country, show the banner rather
  // than silently skipping consent for an unknown visitor.
  const requireConsent = !countryCode || EU_UK_COUNTRIES.has(countryCode);

  return new Response(JSON.stringify({ requireConsent }), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
};

export const config = { path: '/geo-check' };
