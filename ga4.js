(function () {
  var GA_MEASUREMENT_ID = 'G-2K0ZL5DN2W';
  var CONSENT_KEY = 'pilotrep_cookie_consent';

  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = gtag;

  var gtagScriptLoaded = false;
  function loadGtagScript() {
    if (gtagScriptLoaded) return;
    gtagScriptLoaded = true;
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_MEASUREMENT_ID;
    document.head.appendChild(s);
  }

  // Sets the initial consent state and starts GA4. Consent Mode v2 means GA4
  // only actually sets cookies once 'granted' — 'denied' still pings Google
  // in a cookieless form for basic modeling, but stores nothing on-device.
  function applyConsent(state) {
    gtag('consent', 'default', {
      ad_storage: state,
      ad_user_data: state,
      ad_personalization: state,
      analytics_storage: state
    });
    gtag('js', new Date());
    gtag('config', GA_MEASUREMENT_ID);
    loadGtagScript();
  }

  function updateConsent(state) {
    localStorage.setItem(CONSENT_KEY, state);
    gtag('consent', 'update', {
      ad_storage: state,
      ad_user_data: state,
      ad_personalization: state,
      analytics_storage: state
    });
    hideBanner();
  }

  var stylesInjected = false;
  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;
    var style = document.createElement('style');
    style.textContent =
      '#cookieConsentBanner{position:fixed;left:0;right:0;bottom:0;z-index:9999;' +
      'background:#0e1a2b;border-top:1px solid var(--cyan-dim,#2a4a5e);padding:16px 24px;' +
      'display:flex;align-items:center;justify-content:center;gap:24px;flex-wrap:wrap;' +
      'font-family:Helvetica,Arial,sans-serif;}' +
      '.cookie-consent-text{color:var(--white,#fff);font-size:13px;max-width:640px;line-height:1.5;}' +
      '.cookie-consent-buttons{display:flex;gap:12px;flex-shrink:0;}' +
      '.cookie-consent-btn{font-size:11px;font-weight:600;letter-spacing:0.08em;' +
      'text-transform:uppercase;padding:9px 20px;border-radius:4px;cursor:pointer;' +
      'transition:background 0.15s,border-color 0.15s;}' +
      '.cookie-consent-accept{background:var(--cyan,#4fc3f7);border:1.5px solid var(--cyan,#4fc3f7);color:#0a0e1a;}' +
      '.cookie-consent-accept:hover{background:#7dd8fa;border-color:#7dd8fa;}' +
      '.cookie-consent-reject{background:transparent;border:1.5px solid var(--border,rgba(255,255,255,0.15));color:var(--muted,#8a9bb0);}' +
      '.cookie-consent-reject:hover{color:var(--white,#fff);border-color:var(--cyan-dim,#2a4a5e);}' +
      '@media (max-width:640px){#cookieConsentBanner{flex-direction:column;text-align:center;gap:14px;padding:18px 20px;}}';
    document.head.appendChild(style);
  }

  var bannerEl = null;
  function renderBanner() {
    injectStyles();
    if (bannerEl) { bannerEl.style.display = 'flex'; return; }
    bannerEl = document.createElement('div');
    bannerEl.id = 'cookieConsentBanner';
    bannerEl.innerHTML =
      '<div class="cookie-consent-text">This site uses cookies for basic analytics to help us understand site traffic. You can accept or reject them below and change your choice anytime via Cookie Settings in the footer.</div>' +
      '<div class="cookie-consent-buttons">' +
        '<button type="button" id="cookieRejectBtn" class="cookie-consent-btn cookie-consent-reject">Reject</button>' +
        '<button type="button" id="cookieAcceptBtn" class="cookie-consent-btn cookie-consent-accept">Accept</button>' +
      '</div>';
    document.body.appendChild(bannerEl);
    document.getElementById('cookieAcceptBtn').addEventListener('click', function () { updateConsent('granted'); });
    document.getElementById('cookieRejectBtn').addEventListener('click', function () { updateConsent('denied'); });
  }

  function hideBanner() {
    if (bannerEl) bannerEl.style.display = 'none';
  }

  // Exposed so the footer's "Cookie Settings" link can reopen this for
  // anyone who wants to change a previous choice.
  window.pilotrepOpenCookieSettings = function () { renderBanner(); };

  var storedConsent = localStorage.getItem(CONSENT_KEY);

  if (storedConsent === 'granted' || storedConsent === 'denied') {
    // Returning visitor with a prior choice — honor it directly, no geo
    // check and no banner needed.
    applyConsent(storedConsent);
    return;
  }

  // No prior choice yet — only UK/EU visitors need to be asked; everyone
  // else gets GA4 running as before with no interruption.
  fetch('/geo-check')
    .then(function (res) { return res.json(); })
    .then(function (data) { start(!!data.requireConsent); })
    .catch(function () { start(true); }); // fail closed: assume UK/EU on error

  function start(requireConsent) {
    if (!requireConsent) {
      applyConsent('granted');
      return;
    }
    applyConsent('denied');
    renderBanner();
  }
})();
