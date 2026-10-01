/* ===========================================================================
   ELECTION BANNER  (v1)
   ---------------------------------------------------------------------------
   One bar across the top of every page while an election is running, and
   nothing at all the rest of the time.

   WHY A BANNER RATHER THAN A POPUP

   A modal would be the obvious reading of "pop up", and it is the wrong
   shape. It interrupts whatever someone opened the site to do, it has to be
   dismissed before the page is usable, and the reflex it teaches is to close
   it without reading. A bar is unmissable without being in the way, and it
   can stay up for the whole voting window without becoming an irritation.

   WHAT IT WILL NOT DO

   - It never shows to someone with nothing left to do. Once you have cast a
     ballot, or applied during nominations, it goes quiet. A banner that keeps
     shouting after you have acted is how people learn to ignore banners.
   - It stays dismissed for the phase you dismissed it in, not forever. Close
     it during nominations and it comes back when voting opens, because that
     is a different thing being asked of you.
   - It costs one small request. /api/elections/live reads a single row and
     returns four fields; every page paying the full elections page's cost for
     a banner check would be a tax on the whole site.
   =========================================================================== */
(function () {
  'use strict';

  var API = 'https://earthmc-ethiopia-proxy.ethiopianempire2.workers.dev';
  var KEY = 'ethiopia-election-dismissed';

  function dismissedFor(id, status) {
    try { return localStorage.getItem(KEY) === id + ':' + status; }
    catch (e) { return false; }
  }
  function dismiss(id, status) {
    try { localStorage.setItem(KEY, id + ':' + status); } catch (e) {}
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* How long is left, in words. "Closes 14 Oct 19:00" asks the reader to work
     out whether that is soon; "closes in 3 hours" does not. */
  function remaining(iso) {
    if (!iso) return '';
    var ms = new Date(iso).getTime() - Date.now();
    if (isNaN(ms) || ms <= 0) return '';
    var mins = Math.round(ms / 60000);
    if (mins < 60) return 'in ' + mins + ' minute' + (mins === 1 ? '' : 's');
    var hrs = Math.round(mins / 60);
    if (hrs < 48) return 'in ' + hrs + ' hour' + (hrs === 1 ? '' : 's');
    return 'in ' + Math.round(hrs / 24) + ' days';
  }

  function show(live) {
    if (document.getElementById('electionBanner')) return;

    var voting = live.status === 'voting';
    var left = remaining(voting ? live.closes_at : live.opens_at);

    var bar = document.createElement('div');
    bar.id = 'electionBanner';
    bar.style.cssText =
      'position:sticky;top:0;z-index:9000;display:flex;align-items:center;gap:.8rem;' +
      'flex-wrap:wrap;padding:.6rem 1rem;font-family:"Martian Mono",monospace;' +
      'font-size:.72rem;color:#12100c;' +
      'background:' + (voting ? '#189d4d' : '#edb912') + ';' +
      'box-shadow:0 2px 10px rgba(0,0,0,.45)';

    bar.innerHTML =
      '<b style="font-weight:600">' + (voting ? 'Voting is open' : 'Nominations are open') + '</b>' +
      '<span style="opacity:.85">' + esc(live.name) +
        (left ? ' · ' + (voting ? 'closes ' : 'voting opens ') + left : '') + '</span>' +
      '<a href="elections.html" style="margin-left:auto;background:#12100c;color:#f4efe4;' +
        'text-decoration:none;padding:.32rem .8rem;border-radius:999px;font-weight:600">' +
        (voting ? 'Cast your ballot' : 'Stand or see who is') + '</a>' +
      '<button type="button" id="electionBannerX" aria-label="Dismiss" ' +
        'style="background:rgba(0,0,0,.22);border:0;color:#12100c;border-radius:999px;' +
        'width:1.4rem;height:1.4rem;line-height:1;cursor:pointer;font-weight:700">×</button>';

    document.body.insertBefore(bar, document.body.firstChild);
    document.getElementById('electionBannerX').addEventListener('click', function () {
      dismiss(live.id, live.status);
      bar.remove();
    });
  }

  async function check() {
    try {
      var res = await fetch(API + '/api/elections/live', { credentials: 'include' });
      if (!res.ok) return;
      var data = await res.json();
      var live = data && data.live;
      if (!live) return;
      /* Nothing left for this person to do, or they have already closed it for
         this phase. Both are deliberate silence rather than a missing banner. */
      if (live.acted) return;
      if (dismissedFor(live.id, live.status)) return;
      show(live);
    } catch (e) { /* signed out, offline, or the Worker is down — say nothing */ }
  }

  /* Not on the elections page itself: pointing someone at the page they are
     already looking at is noise. */
  if (!/elections\.html$/i.test(location.pathname)) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', check);
    } else {
      check();
    }
    /* Re-checked every few minutes so a phase change reaches someone who left
       a tab open, which during a vote is most people. */
    setInterval(check, 5 * 60 * 1000);
  }
})();
