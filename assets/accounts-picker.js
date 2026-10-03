/* ===========================================================================
   ACCOUNT PICKER  (v1)
   ---------------------------------------------------------------------------
   One way to choose a person, everywhere a manager has to.

   WHAT IT REPLACES

   Nothing. Three fields on this site ask a manager to identify someone and
   all three are raw text boxes: a Discord ID on the government page, a
   Minecraft name beside it, and a representative ID on the job board. Each
   wants a different value and none of them tells you whether what you typed
   matches a real account until you press Save and find out.

   HOW IT ATTACHES

   By enhancing those inputs, not replacing them. An input opts in with
   data-account-picker and otherwise stays exactly what it was — same id, same
   name, same value read by the same code. If this file fails to load, if the
   roster request 401s because the viewer is not a manager, or if the search
   finds nothing, the field is still a working text box and every page
   continues to behave as it did before. That is deliberate: a picker that
   breaks the form when it breaks is worse than no picker.

   WHY EVENT DELEGATION RATHER THAN A SCAN

   The job board rebuilds its rows on every render, so its edit fields do not
   exist when this script runs and are replaced whenever anything changes. A
   one-off querySelectorAll would attach to inputs that are thrown away
   seconds later. Listening on the document catches them whenever they appear,
   with nothing to re-run and nothing to keep in step.
   =========================================================================== */
(function () {
  'use strict';

  var API = 'https://earthmc-ethiopia-proxy.ethiopianempire2.workers.dev';
  var MIN_CHARS = 1;
  var DEBOUNCE_MS = 220;

  var box = null;          // the open dropdown, if any
  var owner = null;        // the input it belongs to
  var timer = null;
  var seq = 0;             // guards against a slow response overwriting a fast one
  var disabled = false;    // set once the roster refuses us

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function close() {
    if (box && box.parentNode) box.parentNode.removeChild(box);
    box = null; owner = null;
  }

  function open(input) {
    if (box && owner === input) return box;
    close();
    box = document.createElement('div');
    box.className = 'account-picker';
    box.style.cssText =
      'position:absolute;z-index:9500;min-width:16rem;max-height:17rem;overflow-y:auto;' +
      'background:#16130f;border:1px solid #2f2a23;border-radius:6px;' +
      'box-shadow:0 8px 24px rgba(0,0,0,.55);font-family:"Martian Mono",monospace;' +
      'font-size:.72rem';
    document.body.appendChild(box);
    owner = input;
    position(input);
    return box;
  }

  /* Positioned against the document rather than the input's offsetParent: these
     fields sit inside panels that scroll and transform, and an absolutely
     positioned child of one of those lands in the wrong place often enough to
     be useless. */
  function position(input) {
    if (!box) return;
    var r = input.getBoundingClientRect();
    box.style.left = (r.left + window.scrollX) + 'px';
    box.style.top = (r.bottom + window.scrollY + 4) + 'px';
    box.style.minWidth = Math.max(r.width, 240) + 'px';
  }

  function row(a, input, mode, also) {
    var el = document.createElement('div');
    el.style.cssText =
      'display:flex;align-items:center;gap:.5rem;padding:.4rem .55rem;cursor:pointer;' +
      'border-bottom:1px solid #221e19';
    el.onmouseenter = function () { el.style.background = '#26221c'; };
    el.onmouseleave = function () { el.style.background = ''; };

    var head = a.mc_name
      ? '<img src="https://minotar.net/helm/' + encodeURIComponent(a.mc_name) + '/20.png" ' +
        'alt="" width="20" height="20" style="width:20px;height:20px;border-radius:2px;' +
        'image-rendering:pixelated;flex:none" onerror="this.style.visibility=\'hidden\'">'
      : '<span style="width:20px;height:20px;border-radius:2px;background:#26221c;flex:none"></span>';

    var party = a.party_abbrev
      ? '<span style="color:' + esc(a.party_colour || '#a89e8c') + ';font-size:.62rem;' +
        'border:1px solid currentColor;border-radius:2px;padding:0 .22rem">' +
        esc(a.party_abbrev) + '</span>'
      : '';

    el.innerHTML = head +
      '<span style="color:#f4efe4">' + esc(a.mc_name || '—') + '</span>' +
      '<span style="color:#756c5d;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
        esc(a.discord_name || '') + '</span>' +
      party;

    el.addEventListener('mousedown', function (e) {
      // mousedown, not click: blur fires first on click and closes the list.
      e.preventDefault();
      choose(input, a, mode, also);
    });
    return el;
  }

  function setValue(input, value) {
    input.value = value == null ? '' : value;
    /* Both events, because pages listen for different ones — the job board's
       preview updates on input, government's save reads on change. Firing one
       would silently work on some fields and not others. */
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function valueFor(a, mode) {
    return mode === 'mcName' ? (a.mc_name || '')
         : mode === 'accountId' ? (a.id || '')
         : (a.discord_id || '');
  }

  function choose(input, a, mode, also) {
    setValue(input, valueFor(a, mode));
    /* A companion field, for the one place that wants both halves of the same
       identity — picking a person should not mean typing them twice. */
    if (also) {
      also.split(',').forEach(function (pair) {
        var bits = pair.split(':');
        var el = document.getElementById((bits[0] || '').trim());
        if (el) setValue(el, valueFor(a, (bits[1] || 'mcName').trim()));
      });
    }
    close();
  }

  async function search(input) {
    var mode = input.getAttribute('data-account-picker') || 'discordId';
    var also = input.getAttribute('data-account-also') || '';
    var q = input.value.trim();
    if (q.length < MIN_CHARS) { close(); return; }

    var mine = ++seq;
    var list;
    try {
      var res = await fetch(API + '/api/admin/accounts?q=' + encodeURIComponent(q),
        { credentials: 'include' });
      if (res.status === 401 || res.status === 403) {
        /* Not a manager. Stop asking — the field keeps working as plain text,
           which for a non-manager is all it ever was. */
        disabled = true; close(); return;
      }
      if (!res.ok) { close(); return; }
      var data = await res.json();
      list = (data && data.accounts) || [];
    } catch (e) { close(); return; }

    if (mine !== seq) return;          // a newer keystroke already answered
    if (!list.length) { close(); return; }

    var el = open(input);
    el.innerHTML = '';
    list.slice(0, 30).forEach(function (a) { el.appendChild(row(a, input, mode, also)); });
    if (list.length > 30) {
      var more = document.createElement('div');
      more.style.cssText = 'padding:.35rem .55rem;color:#756c5d;font-size:.64rem';
      more.textContent = list.length - 30 + ' more — keep typing to narrow it';
      el.appendChild(more);
    }
  }

  document.addEventListener('input', function (e) {
    var t = e.target;
    if (disabled || !t || !t.matches || !t.matches('input[data-account-picker]')) return;
    clearTimeout(timer);
    timer = setTimeout(function () { search(t); }, DEBOUNCE_MS);
  }, true);

  document.addEventListener('focusin', function (e) {
    var t = e.target;
    if (disabled || !t || !t.matches || !t.matches('input[data-account-picker]')) return;
    if (t.value.trim().length >= MIN_CHARS) search(t);
  }, true);

  document.addEventListener('focusout', function (e) {
    if (e.target === owner) setTimeout(close, 120);   // let a click land first
  }, true);

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && box) close();
  }, true);

  /* The list is anchored to a point on the page, so anything that moves the
     page has to move it too — or it detaches and floats over the wrong field. */
  window.addEventListener('scroll', function () { if (owner) position(owner); }, true);
  window.addEventListener('resize', function () { if (owner) position(owner); });
})();
