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
  function dismissFor(id, status) {
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

  /* The page is blurred rather than dimmed. A dim layer reads as "loading";
     a blur reads as "something is in front of this", which is what is true. */
  function blur(on) {
    var app = document.querySelector('.shell') || document.querySelector('.app');
    if (!app) return;
    app.style.transition = 'filter .18s ease';
    app.style.filter = on ? 'blur(5px)' : '';
    app.style.pointerEvents = on ? 'none' : '';
  }

  function bar(live) {
    if (document.getElementById('electionBar')) return;
    var voting = live.status === 'voting';
    var left = remaining(voting ? live.closes_at : live.opens_at);

    var el = document.createElement('div');
    el.id = 'electionBar';
    el.style.cssText =
      'position:sticky;top:0;z-index:9000;display:flex;align-items:center;gap:.8rem;' +
      'flex-wrap:wrap;padding:.55rem 1rem;font-family:"Martian Mono",monospace;' +
      'font-size:.7rem;color:#12100c;background:' + (voting ? '#189d4d' : '#edb912') + ';' +
      'box-shadow:0 2px 10px rgba(0,0,0,.4)';
    el.innerHTML =
      '<b>' + (voting ? 'Voting is open' : 'Nominations are open') + '</b>' +
      '<span style="opacity:.85">' + esc(live.name) +
        (left ? ' \u00b7 ' + (voting ? 'closes ' : 'voting opens ') + left : '') + '</span>' +
      '<a href="elections.html" style="margin-left:auto;background:#12100c;color:#f4efe4;' +
        'text-decoration:none;padding:.3rem .8rem;border-radius:999px;font-weight:600">' +
        (voting ? 'Cast your ballot' : 'Stand or see who is') + '</a>';
    document.body.insertBefore(el, document.body.firstChild);
  }

  function modal(live) {
    if (document.getElementById('electionModal')) return;
    var voting = live.status === 'voting';
    var left = remaining(voting ? live.closes_at : live.opens_at);
    var accent = voting ? '#189d4d' : '#edb912';

    var wrap = document.createElement('div');
    wrap.id = 'electionModal';
    wrap.style.cssText =
      'position:fixed;inset:0;z-index:9800;display:flex;align-items:center;' +
      'justify-content:center;padding:1.2rem;background:rgba(8,7,5,.55)';

    wrap.innerHTML =
      '<div role="dialog" aria-modal="true" aria-label="Election notice" style="' +
        'max-width:26rem;width:100%;background:#16130f;border:1px solid #2f2a23;' +
        'border-top:3px solid ' + accent + ';border-radius:10px;padding:1.6rem 1.5rem;' +
        'box-shadow:0 20px 60px rgba(0,0,0,.7);text-align:center;position:relative">' +
        '<button type="button" id="electionModalX" aria-label="Close" style="' +
          'position:absolute;top:.6rem;right:.7rem;background:none;border:0;' +
          'color:#756c5d;font-size:1.3rem;line-height:1;cursor:pointer">&times;</button>' +
        '<div style="font-family:Martian Mono,monospace;font-size:.62rem;' +
          'letter-spacing:.12em;text-transform:uppercase;color:' + accent + '">' +
          (voting ? 'Voting is open' : 'Nominations are open') + '</div>' +
        '<div style="font-family:Fraunces,Georgia,serif;font-size:1.5rem;font-weight:600;' +
          'color:#f4efe4;margin:.5rem 0 .3rem">' + esc(live.name) + '</div>' +
        '<p style="font-family:Karla,sans-serif;font-size:.86rem;color:#b3a894;margin:0 0 1.2rem">' +
          (voting
            ? 'One account, one ballot. ' + (left ? 'Voting closes ' + left + '.' : '')
            : 'Apply to stand for an office or a House seat. ' +
              (left ? 'Voting opens ' + left + '.' : '')) +
        '</p>' +
        '<a href="elections.html" style="display:inline-block;background:' + accent + ';' +
          'color:#12100c;text-decoration:none;font-family:Martian Mono,monospace;' +
          'font-size:.8rem;font-weight:600;padding:.6rem 1.4rem;border-radius:999px">' +
          (voting ? 'Cast your ballot' : 'See the ballot') + '</a>' +
        '<div style="margin-top:.9rem"><button type="button" id="electionModalLater" style="' +
          'background:none;border:0;color:#756c5d;font-family:Martian Mono,monospace;' +
          'font-size:.68rem;cursor:pointer;text-decoration:underline">Not now</button></div>' +
      '</div>';

    document.body.appendChild(wrap);
    blur(true);

    var dismiss = function () {
      dismissFor(live.id, live.status);
      blur(false);
      wrap.remove();
      bar(live);            // acknowledged, but still one tap away
    };
    document.getElementById('electionModalX').addEventListener('click', dismiss);
    document.getElementById('electionModalLater').addEventListener('click', dismiss);
    wrap.addEventListener('click', function (e) { if (e.target === wrap) dismiss(); });
    document.addEventListener('keydown', function onEsc(e) {
      if (e.key === 'Escape' && document.getElementById('electionModal')) {
        dismiss(); document.removeEventListener('keydown', onEsc);
      }
    });
    /* Going to vote counts as having seen it, or it reappears the moment the
       elections page sends you anywhere else. */
    wrap.querySelector('a').addEventListener('click', function () {
      dismissFor(live.id, live.status); blur(false);
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
      if (live.acted) return;                        // nothing left to ask
      if (dismissedFor(live.id, live.status)) bar(live);
      else modal(live);
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
    /* Only the BAR may appear on the interval. A modal that materialises over
       someone mid-sentence is an ambush, so a phase change found this way is
       announced quietly and the modal waits for the next page load. */
    setInterval(function () {
      if (document.getElementById('electionModal')) return;
      check();
    }, 5 * 60 * 1000);
  }
})();
