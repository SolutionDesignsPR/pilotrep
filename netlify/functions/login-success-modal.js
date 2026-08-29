(function () {
  var params = new URLSearchParams(window.location.search);
  if (params.get('login') !== 'success') return;

  var SEEN_KEY = 'pilotrep_welcome_seen';
  var hasNewRep = params.get('newRep') === '1';
  var showOnboarding = !localStorage.getItem(SEEN_KEY);

  // Repeat login, no new rep — nothing to show. Just clean the URL.
  if (!showOnboarding && !hasNewRep) {
    stripParams();
    return;
  }

  var style = document.createElement('style');
  style.textContent =
    '.pr-modal-overlay{position:fixed;inset:0;background:rgba(4,8,15,0.72);' +
    'display:flex;align-items:center;justify-content:center;padding:24px;z-index:9999;}' +
    '.pr-modal-box{width:100%;max-width:420px;background:var(--panel);' +
    'border:1.5px solid var(--cyan-dim);border-radius:8px;padding:36px 32px;' +
    'text-align:center;position:relative;font-family:Helvetica,Arial,sans-serif;}' +
    '.pr-modal-box.pr-modal-wide{max-width:480px;}' +
    '.pr-modal-close{position:absolute;top:14px;right:16px;background:none;border:none;' +
    'color:var(--muted);font-size:20px;line-height:1;cursor:pointer;padding:4px;}' +
    '.pr-modal-close:hover{color:var(--white);}' +
    '.pr-modal-eyebrow{font-size:12px;letter-spacing:0.15em;color:var(--cyan);' +
    'text-transform:uppercase;margin-bottom:18px;}' +
    '.pr-modal-title{font-size:20px;font-weight:700;color:var(--white);' +
    'margin-bottom:10px;line-height:1.3;}' +
    '.pr-modal-sub{font-size:14px;color:var(--muted);margin-bottom:24px;}' +
    '.pr-modal-steps{text-align:left;display:flex;flex-direction:column;gap:14px;margin-bottom:28px;}' +
    '.pr-modal-step{display:flex;gap:12px;align-items:flex-start;}' +
    '.pr-modal-num{flex-shrink:0;width:22px;height:22px;border-radius:50%;' +
    'border:1.5px solid var(--cyan-dim);color:var(--cyan);font-size:12px;font-weight:700;' +
    'display:flex;align-items:center;justify-content:center;}' +
    '.pr-modal-step p{font-size:13.5px;color:var(--white);line-height:1.5;margin:0;}' +
    '.pr-modal-step p .pr-hl{color:var(--cyan);font-weight:700;}' +
    '.pr-modal-actions{display:flex;flex-direction:column;gap:12px;}' +
    '.pr-modal-btn{width:100%;background:var(--cyan);border:none;border-radius:4px;' +
    'color:var(--bg);font-size:13px;font-weight:700;letter-spacing:0.08em;' +
    'text-transform:uppercase;padding:12px;cursor:pointer;font-family:inherit;}' +
    '.pr-modal-btn:hover{background:#7dd8fa;}' +
    '.pr-modal-btn-secondary{width:auto;min-width:140px;margin:0 auto;background:transparent;' +
    'border:1.5px solid var(--border);border-radius:4px;color:var(--white);font-size:13px;' +
    'font-weight:700;letter-spacing:0.08em;text-transform:uppercase;padding:11px 24px;' +
    'cursor:pointer;font-family:inherit;}' +
    '.pr-modal-btn-secondary:hover{border-color:var(--cyan-dim);}';
  document.head.appendChild(style);

  var boxClass = 'pr-modal-box' + (showOnboarding && hasNewRep ? ' pr-modal-wide' : '');

  var innerHtml = '<button class="pr-modal-close" id="prModalClose" aria-label="Close">&times;</button>';

  if (showOnboarding) {
    innerHtml +=
      '<div class="pr-modal-eyebrow">\u039EV\u039E &bull; secure login</div>' +
      '<h2 class="pr-modal-title" id="prModalTitle">You\u2019re Now Logged In To PilotRep!</h2>' +
      '<p class="pr-modal-sub">Ready to leave your first Rep?</p>' +
      '<div class="pr-modal-steps">' +
        '<div class="pr-modal-step"><div class="pr-modal-num">1</div>' +
          '<p>Search for the pilot, corporation or alliance you want to rate</p></div>' +
        '<div class="pr-modal-step"><div class="pr-modal-num">2</div>' +
          '<p>Click their name and find the <span class="pr-hl">Leave A Rep</span> section</p></div>' +
        '<div class="pr-modal-step"><div class="pr-modal-num">3</div>' +
          '<p>Share your encounter and hit submit</p></div>' +
      '</div>';
  } else {
    // Repeat-login, rep-only view still needs the eyebrow for context.
    innerHtml += '<div class="pr-modal-eyebrow">\u039EV\u039E &bull; secure login</div>';
  }

  innerHtml += '<div class="pr-modal-actions">';
  if (showOnboarding) {
    innerHtml += '<button class="pr-modal-btn-secondary" id="prModalGotIt">Got it</button>';
  }
  if (hasNewRep) {
    innerHtml += '<button class="pr-modal-btn" id="prModalNewRep">You\u2019ve Received A Rep!</button>';
  }
  innerHtml += '</div>';

  var overlay = document.createElement('div');
  overlay.className = 'pr-modal-overlay';
  overlay.innerHTML =
    '<div class="' + boxClass + '" role="dialog" aria-modal="true" aria-labelledby="prModalTitle">' +
      innerHtml +
    '</div>';
  document.body.appendChild(overlay);

  // ── Auto-dismiss (rep-only view on repeat logins only) ──────────────────
  // Copied from the rep-share-toast pattern on pilot.html: 6s auto-close,
  // paused while hovered/focused, resumes shortly after. The first-login
  // onboarding view never gets a timer — people need time to read it.
  var autoDismiss = hasNewRep && !showOnboarding;
  var dismissTimer = null;

  function clearDismissTimer() {
    if (dismissTimer) { clearTimeout(dismissTimer); dismissTimer = null; }
  }

  function startDismissTimer() {
    if (!autoDismiss) return;
    clearDismissTimer();
    dismissTimer = setTimeout(closeModal, 6000);
  }

  if (autoDismiss) {
    overlay.addEventListener('mouseenter', clearDismissTimer);
    overlay.addEventListener('mouseleave', function () {
      clearDismissTimer();
      dismissTimer = setTimeout(closeModal, 1500);
    });
    startDismissTimer();
  }

  function closeModal() {
    clearDismissTimer();
    if (showOnboarding) localStorage.setItem(SEEN_KEY, '1');
    overlay.remove();
    stripParams();
  }

  document.getElementById('prModalClose').addEventListener('click', closeModal);
  var gotItBtn = document.getElementById('prModalGotIt');
  if (gotItBtn) gotItBtn.addEventListener('click', closeModal);
  var newRepBtn = document.getElementById('prModalNewRep');
  if (newRepBtn) {
    newRepBtn.addEventListener('click', function () {
      if (showOnboarding) localStorage.setItem(SEEN_KEY, '1');
      window.location.href = 'my-pilotrep.html';
    });
  }
  overlay.addEventListener('click', function (e) {
    if (e.target === overlay) closeModal();
  });

  function stripParams() {
    params.delete('login');
    params.delete('newRep');
    var qs = params.toString();
    var newUrl = window.location.pathname + (qs ? '?' + qs : '') + window.location.hash;
    window.history.replaceState({}, '', newUrl);
  }
})();
