/* ===========================================================================
   SESSION  (v1)  —  must load BEFORE every other script on the page
   ---------------------------------------------------------------------------
   WHY THIS EXISTS

   The site is served from github.io; the API lives on workers.dev. Every API
   call is therefore cross-site, and the session cookie is a third-party
   cookie — which iOS Safari blocks by default, and Chrome is in the process
   of doing the same. No combination of SameSite, Secure or Partitioned flags
   changes that; it is the whole point of the setting.

   The result was a sign-in that looked broken but was not: the OAuth round
   trip completed, the session row was written, the cookie was set and stored
   — and then never sent back. The next request arrived anonymous, so the page
   showed a signed-out state and nothing explained why.

   WHAT THIS DOES

   The Worker now also hands the session token back in the URL fragment after
   login. This file picks it up, keeps it, and sends it as an Authorization
   header on every API request. Headers are not cookies, so no tracking
   prevention touches them.

   The cookie is still the primary path wherever it works, because HttpOnly
   keeps it out of reach of any script on the page. This is the fallback, and
   it only matters on browsers that refuse the cookie.

   WHY IT PATCHES fetch RATHER THAN EACH PAGE

   Every page has its own api() helper, seven of them, written at different
   times. Teaching each one about bearer tokens means seven edits that have to
   stay in step forever. Wrapping fetch once means they all inherit it and
   none of them has to know this problem exists. The wrapper touches only
   requests aimed at the Worker and leaves every other fetch exactly as it
   was.
   =========================================================================== */
(function () {
  'use strict';

  var API = 'https://earthmc-ethiopia-proxy.ethiopianempire2.workers.dev';
  var KEY = 'ethiopia-session';

  function store(token) {
    try { localStorage.setItem(KEY, token); } catch (e) { /* private mode */ }
  }
  function token() {
    try { return localStorage.getItem(KEY) || ''; } catch (e) { return ''; }
  }
  function forget() {
    try { localStorage.removeItem(KEY); } catch (e) {}
  }

  /* Picked out of the fragment the Worker redirected to, then removed from the
     address bar at once — replaceState rather than assigning location.hash, so
     it leaves no history entry to go "back" into. */
  (function capture() {
    var m = /[#&]session=([^&]+)/.exec(location.hash || '');
    if (!m) return;
    try { store(decodeURIComponent(m[1])); } catch (e) { store(m[1]); }
    var clean = location.pathname + location.search;
    try { history.replaceState(null, '', clean); }
    catch (e) { location.hash = ''; }
  })();

  var realFetch = window.fetch.bind(window);

  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input
      : (input && input.url) ? input.url : '';

    // Only our own API. Everything else — tiles, Minotar heads, squaremap —
    // is left completely alone.
    if (url.indexOf(API) !== 0) return realFetch(input, init);

    var t = token();
    if (!t) return realFetch(input, init);

    var opts = Object.assign({}, init || {});
    var headers = new Headers(
      (init && init.headers) || (typeof input === 'object' && input.headers) || {}
    );
    // Never overwrite an Authorization header a caller set deliberately.
    if (!headers.has('Authorization')) headers.set('Authorization', 'Bearer ' + t);
    opts.headers = headers;
    // Cookies still go too, so a browser that allows them keeps using them.
    if (!opts.credentials) opts.credentials = 'include';

    return realFetch(typeof input === 'string' ? input : input.url, opts)
      .then(function (res) {
        /* A 401 on a request we attached a token to means the token is dead —
           expired, or its session was deleted. Dropping it here stops every
           later request carrying a credential the server has already refused,
           and lets the page show a clean signed-out state instead of looping. */
        if (res.status === 401 && url.indexOf('/api/auth/') < 0) forget();
        return res;
      });
  };

  /* Signing out has to clear the token as well as the cookie, or the next
     request would re-authenticate with something the user just discarded. */
  window.addEventListener('click', function (e) {
    var el = e.target && e.target.closest ? e.target.closest('#signout, #logout') : null;
    if (el) forget();
  }, true);

  window.ethiopiaSession = { token: token, forget: forget };
})();
