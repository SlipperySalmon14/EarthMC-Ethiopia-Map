/* ===========================================================================
   SESSION  (v2)  —  must load BEFORE every other script on the page
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

   The Worker also hands the session token back in the URL fragment after
   login. This file picks it up, keeps it, and sends it as an Authorization
   header on API requests. Headers are not cookies, so no tracking prevention
   touches them.

   The cookie is still sent wherever the browser allows it, because HttpOnly
   keeps it out of reach of any script on the page. The Worker tries both.

   WHAT CHANGED FROM v1, AND WHY v1 BROKE SIGN-IN

   1. The token now goes ONLY to /api/* and /regions.
      v1 attached it to everything on the Worker's address, including the
      /?url= forwarder that fetches EarthMC data and map tiles. Attaching it
      also switched those requests to credentialed mode, and the forwarder
      answers with a wildcard origin, which a browser refuses outright for a
      credentialed request. Every forwarded call failed with "Failed to
      fetch" for anyone holding a token. The forwarder never reads a session,
      so it never needed one.

   2. A 401 no longer throws the token away.
      v1 treated any 401 as "this session is dead". But most 401s on this API
      mean "you are signed in, just not senior enough" — a citizen opening a
      page that also asks for treasurer-only figures. v1 deleted a perfectly
      good token on that, so on a phone, where there is no cookie to fall back
      on, simply opening the treasury signed you out. The token is now dropped
      only when /api/me says plainly that it is not signed in.

   3. Signing out sends the token before forgetting it.
      v1 forgot it on the click, before the logout request left, so on a
      phone the server never learned which session to end. The row sat there,
      valid, until it expired on its own.

   WHY IT PATCHES fetch RATHER THAN EACH PAGE

   Every page has its own api() helper, written at different times. Teaching
   each one about bearer tokens means a dozen edits that have to stay in step
   forever. Wrapping fetch once means they all inherit it and none of them
   has to know this problem exists.
   =========================================================================== */
(function () {
  'use strict';

  var API = 'https://earthmc-ethiopia-proxy.ethiopianempire2.workers.dev';
  var KEY = 'ethiopia-session';

  /* Held between the sign-out click and the logout request. The click forgets
     the stored token at once, so a page that reloads straight after signing
     out can never pick it back up; this keeps a copy just long enough for the
     logout request to tell the server which session to delete. */
  var pendingLogout = '';

  function store(t) {
    try { localStorage.setItem(KEY, t); } catch (e) { /* private mode */ }
  }
  function token() {
    try { return localStorage.getItem(KEY) || ''; } catch (e) { return ''; }
  }
  function forget() {
    try { localStorage.removeItem(KEY); } catch (e) {}
  }

  /* The part of a Worker URL after the host, or null for anything else. */
  function workerPath(url) {
    return url.indexOf(API) === 0 ? url.slice(API.length) : null;
  }

  /* Session-aware routes only. The /?url= forwarder is deliberately left
     out: see point 1 at the top of this file. */
  function wantsToken(path) {
    return path !== null &&
      (path.indexOf('/api/') === 0 || /^\/regions(?:[/?#]|$)/.test(path));
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
      : (input && typeof input.url === 'string') ? input.url : '';
    var path = workerPath(url);

    if (!wantsToken(path)) return realFetch(input, init);

    var isLogout = path.indexOf('/api/auth/logout') === 0;
    var t = isLogout ? (pendingLogout || token()) : token();
    if (isLogout) {
      // Whatever happens to the request, this device is signed out now.
      pendingLogout = '';
      forget();
    }
    if (!t) return realFetch(input, init);

    var headers = new Headers(
      (init && init.headers) || (typeof input === 'object' && input.headers) || {}
    );
    // Never overwrite an Authorization header a caller set deliberately.
    if (!headers.has('Authorization')) headers.set('Authorization', 'Bearer ' + t);

    var opts = Object.assign({}, init || {}, { headers: headers });
    // Cookies still go too, so a browser that allows them keeps using them.
    if (!opts.credentials) opts.credentials = 'include';

    var sent = typeof input === 'string'
      ? realFetch(input, opts)
      : realFetch(new Request(input, opts));

    if (!/^\/api\/me(?:[?#]|$)/.test(path)) return sent;

    /* The one reliable signal that the token itself is dead: we sent it, and
       /api/me answered "not signed in". Read from a clone so the page still
       gets an unread body. The token() === t check stops a slow response from
       wiping a newer token that a fresh sign-in stored in the meantime. */
    return sent.then(function (res) {
      res.clone().json().then(function (body) {
        if (body && body.signedIn === false && token() === t) forget();
      }).catch(function () { /* not JSON; nothing to learn */ });
      return res;
    });
  };

  window.addEventListener('click', function (e) {
    var el = e.target && e.target.closest ? e.target.closest('#signout, #logout') : null;
    if (!el) return;
    pendingLogout = token();
    forget();
  }, true);

  window.ethiopiaSession = { token: token, forget: forget };
})();
