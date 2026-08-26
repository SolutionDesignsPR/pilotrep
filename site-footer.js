document.write(
  '<footer class="site-footer">' +
    '<div class="footer-grid">' +
      '<a href="about.html">About</a>' +
      '<a href="my-pilotrep.html" id="myPilotRepLink">My PilotRep</a>' +
      '<a href="/.netlify/functions/auth-start" id="footerAuthLink">Login</a>' +
      '<a href="top-contributors.html">Top Contributors</a>' +
      '<a href="contact.html">Contact</a>' +
      '<a href="support-us.html">Support Us</a>' +
    '</div>' +
    '<div class="footer-legal-links">' +
      '<a href="faq.html">FAQ</a>' +
      '<a href="privacy-policy.html">Privacy Policy</a>' +
      '<a href="serviceterms.html">Terms Of Service</a>' +
      '<a href="#" id="cookieSettingsLink">Cookie Settings</a>' +
    '</div>' +
    '<div class="eve-time" id="eveTime" style="margin-top:28px;">EVE TIME 00:00:00</div>' +
    '<div class="legal-note" style="margin-top:10px;">' +
      'EVE Online and all related materials are property of Fenris Creations.<br>PilotRep is a third-party fan site and is not affiliated with Fenris Creations.' +
    '</div>' +
    '<div class="footer-copy">&copy; 2026 PilotRep. All rights reserved.</div>' +
  '</footer>'
);

(function () {
  function updateEveTime() {
    var el = document.getElementById('eveTime');
    if (!el) return;
    var now = new Date();
    var h = String(now.getUTCHours()).padStart(2, '0');
    var m = String(now.getUTCMinutes()).padStart(2, '0');
    var s = String(now.getUTCSeconds()).padStart(2, '0');
    el.textContent = 'EVE TIME  ' + h + ':' + m + ':' + s;
  }
  updateEveTime();
  setInterval(updateEveTime, 1000);

  fetch('/.netlify/functions/auth-me')
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (data.loggedIn) {
        var authLink = document.getElementById('footerAuthLink');
        if (authLink) {
          authLink.textContent = 'Logout';
          authLink.href = '/.netlify/functions/auth-logout';
        }
      }
    })
    .catch(function () {});

  var cookieLink = document.getElementById('cookieSettingsLink');
  if (cookieLink) {
    cookieLink.addEventListener('click', function (e) {
      e.preventDefault();
      if (window.pilotrepOpenCookieSettings) window.pilotrepOpenCookieSettings();
    });
  }
})();
