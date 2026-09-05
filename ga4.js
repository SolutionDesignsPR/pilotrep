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
    trackLoginIfNeeded();
    trackProfileViewIfApplicable();
  }

  // Fires GA4's standard "login" event whenever auth-callback.js has just
  // redirected here with ?login=success — same signal login-success-modal.js
  // already relies on. Runs once per actual login redirect, whether it's a
  // first-time login or a repeat one. Queued through the same gtag() call
  // as everything else, so it automatically respects whatever consent state
  // was just set above (a rejected-cookies pilot still sends a cookieless,
  // non-identifiable ping — same as any other event on the site).
  //
  // The param is cleared from the URL right after firing (history.replaceState,
  // no reload) so a page refresh while ?login=success is still in the address
  // bar can't fire a second, duplicate "login" event. login-success-modal.js
  // does its own separate cleanup when the welcome modal closes, but that can
  // be several seconds later (or never, if the tab is refreshed first) — this
  // makes the GA4 side of things safe regardless of that timing.
  function trackLoginIfNeeded() {
    var params = new URLSearchParams(window.location.search);
    if (params.get('login') === 'success') {
      gtag('event', 'login', { method: 'EVE SSO' });
      params.delete('login');
      var qs = params.toString();
      var newUrl = window.location.pathname + (qs ? '?' + qs : '') + window.location.hash;
      window.history.replaceState({}, '', newUrl);
    }
  }

  // Fires GA4's "view_profile" event on pilot/corporation/alliance profile
  // pages. Detected purely from the URL (page + ?id=) rather than anything
  // page-specific, so this works for all three profile pages without needing
  // any changes inside pilot.html / corporation.html / alliance.html.
  function trackProfileViewIfApplicable() {
    var path = window.location.pathname.split('/').pop().toLowerCase();
    var entityType = { 'pilot.html': 'pilot', 'corporation.html': 'corporation', 'alliance.html': 'alliance' }[path];
    if (!entityType) return;
    var id = new URLSearchParams(window.location.search).get('id');
    if (!id) return;
    gtag('event', 'view_profile', { entity_type: entityType, entity_id: id });
  }

  // ── Search + rep-submission tracking (site-wide from one place) ───────────
  // The search bar and rep-submission form are both duplicated, page by page,
  // across the whole site rather than living in one shared header/component —
  // so rather than editing every page individually, this wraps fetch() once,
  // here, and watches for the two backend endpoints every page's copy already
  // calls: esi-proxy?action=search (every search, on every page, including
  // search.html itself) and submit-rep (every pilot/corp/alliance rep
  // submission). Whichever page the request comes from, it gets tracked.
  var nativeFetch = window.fetch;
  if (typeof nativeFetch === 'function') {
    window.fetch = function (input, init) {
      try {
        var url = typeof input === 'string' ? input : (input && input.url) || '';

        if (url.indexOf('/esi-proxy') !== -1 && url.indexOf('action=search') !== -1) {
          var qMatch = url.match(/[?&]query=([^&]+)/);
          if (qMatch) {
            gtag('event', 'search', { search_term: decodeURIComponent(qMatch[1]) });
          }
        }

        if (url.indexOf('/submit-rep') !== -1 && init && init.method === 'POST') {
          var payload = null;
          try { payload = JSON.parse(init.body); } catch (e) {}
          if (payload) {
            return nativeFetch.apply(this, arguments).then(function (res) {
              if (res.ok) {
                gtag('event', 'submit_rep', {
                  target_type: payload.targetType || '',
                  grade: payload.grade || '',
                  anonymous: !!payload.anonymous
                });
              }
              return res;
            });
          }
        }
      } catch (e) { /* tracking must never break a real request */ }
      return nativeFetch.apply(this, arguments);
    };
  }

  function updateConsent(state) {
    localStorage.setItem(CONSENT_KEY, state);
    gtag('consent', 'update', {
      ad_storage: state,
      ad_user_data: state,
      ad_personalization: state,
      analytics_storage: state
    });
    fetch('/.netlify/functions/log-consent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ choice: state })
    }).catch(function () { /* logging must never block the UI */ });
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
