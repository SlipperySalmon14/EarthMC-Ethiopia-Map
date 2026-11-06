/* ===========================================================================
   Editable page text  (v2)
   ---------------------------------------------------------------------------
   Any piece of text on any page can be reworded, and the new wording is
   saved and shown to everyone.

   HOW IT FINDS TEXT

   v1 only reached elements a page had marked with data-slot, so most of the
   site could not be changed. v2 reaches every piece of text: a change is
   keyed by the wording it replaces ("text:Current balance"), and wherever
   that wording appears on the page it is swapped for the new one — in the
   page as shipped, and in anything the page draws later. Pages here rebuild
   whole sections after every load, so a watcher re-applies changes to new
   text as it appears rather than once at start-up.

   An element marked data-slot still works exactly as before.

   TWO RULES, KEPT FROM v1

     1. The page must read correctly before this runs, and if it never runs.
        Nothing here creates text; it only replaces it.
     2. The language toggle rewrites text from data-en / data-am. A change
        made in English is keyed to the English wording even while the page
        shows Amharic, so one change covers both languages.

   EDITING

   A manager sees an "Edit text" button. With it on, clicking any text opens
   a small box with the original wording, an English and an Amharic field,
   and Save / Back to original. Nothing else on the page reacts to clicks
   while editing, so a button's label can be changed without pressing it.
   =========================================================================== */
(function(){
  'use strict';

  var API = 'https://earthmc-ethiopia-proxy.ethiopianempire2.workers.dev';
  var page = (location.pathname.split('/').pop() || 'index.html').replace(/\.html$/, '') || 'index';
  var overrides = {};
  var editing = false;

  var SKIP = { SCRIPT:1, STYLE:1, NOSCRIPT:1, TEXTAREA:1, CODE:1, PRE:1, TITLE:1 };
  var LETTER = /[A-Za-z\u1200-\u137F]/;

  function currentLang(){ return document.documentElement.getAttribute('data-lang') === 'am' ? 'am' : 'en'; }
  function norm(s){ return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }
  function pick(o){
    var lang = currentLang();
    return (lang === 'am' ? (o.am || o.en) : (o.en || o.am)) || '';
  }

  /* The key for a piece of text is its original wording. Where the element
     carries data-en, the English wording is used even when Amharic is
     showing, so one change follows the text across the language switch. */
  function keyFor(node, orig){
    var t = norm(orig);
    var el = node.parentElement;
    if (el && el.hasAttribute('data-en')) {
      var en = norm(el.getAttribute('data-en')), am = norm(el.getAttribute('data-am'));
      if (en && (t === en || t === am)) return en;
    }
    return t;
  }

  function inUi(el){ return !!(el && el.closest && el.closest('[data-pt-ui]')); }
  function skippable(el){
    for (var e = el; e; e = e.parentElement) {
      if (SKIP[e.tagName] || e.isContentEditable || e.hasAttribute('data-pt-ui') || e.hasAttribute('data-pt-skip')) return true;
    }
    return false;
  }

  /* --- applying ----------------------------------------------------------
     Each text node remembers the wording it had before anything here touched
     it, and what was last written into it. If the page writes something new
     into the node later, that new wording becomes its original. */
  function applyText(node){
    var cur = node.nodeValue;
    if (!cur || !LETTER.test(cur)) return;
    if (node.__ptSet !== cur) { node.__ptOrig = cur; node.__ptSet = undefined; }
    var orig = node.__ptOrig;
    if (orig.length > 400) return;
    var o = overrides['text:' + keyFor(node, orig)];
    var want = o ? pick(o) : '';
    var next;
    if (want) {
      var lead = orig.match(/^\s*/)[0], trail = orig.match(/\s*$/)[0];
      next = lead + want + trail;
    } else next = orig;
    if (next !== cur) { node.__ptSet = next; node.nodeValue = next; }
    else if (want) node.__ptSet = next;
  }
  function applyPlaceholder(el){
    var cur = el.getAttribute('placeholder');
    if (!cur || !LETTER.test(cur)) return;
    if (el.__ptSetPh !== cur) el.__ptOrigPh = cur;
    var o = overrides['text:' + norm(el.__ptOrigPh)];
    var next = o && pick(o) ? pick(o) : el.__ptOrigPh;
    if (next !== cur) { el.__ptSetPh = next; el.setAttribute('placeholder', next); }
  }
  function applySlots(root){
    var lang = currentLang();
    (root.querySelectorAll ? root.querySelectorAll('[data-slot]') : []).forEach(function(el){
      var o = overrides[el.getAttribute('data-slot')];
      if (!o) return;
      var text = (lang === 'am' ? o.am : o.en) || o.en || o.am;
      if (text && el.textContent !== text) el.textContent = text;
    });
  }
  function applyTree(root){
    if (!root) return;
    if (root.nodeType === 3) { if (!skippable(root.parentElement)) applyText(root); return; }
    if (root.nodeType !== 1 || skippable(root)) return;
    applySlots(root);
    var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function(n){ return skippable(n.parentElement) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT; },
    });
    var n; while ((n = w.nextNode())) applyText(n);
    if (root.querySelectorAll) root.querySelectorAll('[placeholder]').forEach(function(el){ if (!skippable(el)) applyPlaceholder(el); });
    if (root.hasAttribute && root.hasAttribute('placeholder')) applyPlaceholder(root);
  }
  function apply(){ applyTree(document.body); }

  /* Pages rebuild sections with innerHTML after every load, and some redraw
     every second (a clock, a countdown). Only what changed is looked at, and
     a write made here is recognised and left alone, so this never loops. */
  var queue = [], queued = false;
  function flush(){
    queued = false;
    var q = queue; queue = [];
    q.forEach(applyTree);
  }
  function watch(){
    new MutationObserver(function(muts){
      if (!Object.keys(overrides).length) return;
      muts.forEach(function(m){
        if (m.type === 'characterData') { if (m.target.nodeValue !== m.target.__ptSet) queue.push(m.target); }
        else m.addedNodes.forEach(function(n){ queue.push(n); });
        if (m.type === 'attributes' && m.attributeName === 'placeholder') queue.push(m.target);
      });
      if (queue.length && !queued) { queued = true; requestAnimationFrame(flush); }
    }).observe(document.body, { childList:true, subtree:true, characterData:true, attributes:true, attributeFilter:['placeholder'] });
  }

  async function load(){
    try {
      var res = await fetch(API + '/api/page-text?page=' + encodeURIComponent(page), { credentials:'include' });
      if (!res.ok) return;
      var data = await res.json();
      overrides = (data && data.text) || {};
      apply();
    } catch (e) { /* offline: the built-in wording stands */ }
  }

  document.addEventListener('click', function(e){
    var t = e.target;
    if (t && t.hasAttribute && t.hasAttribute('data-set-lang')) requestAnimationFrame(apply);
  });

  /* --- editing -----------------------------------------------------------
     Only offered to a manager, and the Worker checks again on save: hiding
     the button protects nothing on its own. */
  var css = '' +
    '[data-pt-ui]{font-family:Karla,system-ui,sans-serif;color:#f5f1e8}' +
    '.pt-toggle{position:fixed;left:calc(env(safe-area-inset-left,0px) + 18px);bottom:calc(env(safe-area-inset-bottom,0px) + 16px);z-index:9998;' +
      'display:inline-flex;align-items:center;gap:.45rem;padding:.5rem .85rem;border-radius:999px;border:1px solid rgba(245,241,232,.22);' +
      'background:rgba(20,18,15,.92);color:#cfc8b8;font:600 .8rem Karla,system-ui,sans-serif;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.5)}' +
    '.pt-toggle:hover{color:#f5f1e8}' +
    '.pt-toggle.on{background:#fcd116;color:#141006;border-color:#fcd116;box-shadow:0 0 22px rgba(252,209,22,.45)}' +
    'body.pt-editing *:not([data-pt-ui]):not([data-pt-ui] *){cursor:text !important}' +
    'body.pt-editing .pt-hot{outline:1px dashed #fcd116 !important;outline-offset:2px;background:rgba(252,209,22,.06)}' +
    '.pt-box{position:fixed;z-index:9999;width:min(25rem,calc(100vw - 24px));padding:.9rem 1rem;border-radius:12px;' +
      'border:1px solid rgba(252,209,22,.45);background:rgba(20,18,15,.98);box-shadow:0 18px 50px rgba(0,0,0,.65)}' +
    '.pt-box h4{margin:0 0 .2rem;font:700 .95rem Karla,system-ui,sans-serif}' +
    '.pt-box .pt-orig{margin:0 0 .7rem;font-size:.8rem;color:#958d7d;word-break:break-word}' +
    '.pt-box label{display:block;margin:.45rem 0 .2rem;font-size:.76rem;font-weight:600;color:#cfc8b8}' +
    '.pt-box textarea{width:100%;min-height:2.6rem;resize:vertical;box-sizing:border-box;padding:.5rem .6rem;border-radius:8px;' +
      'border:1px solid rgba(245,241,232,.2);background:rgba(0,0,0,.35);color:#f5f1e8;font:500 .9rem Karla,system-ui,sans-serif}' +
    '.pt-box textarea:focus{outline:none;border-color:#fcd116}' +
    '.pt-box .pt-row{display:flex;gap:.4rem;flex-wrap:wrap;align-items:center;margin-top:.75rem}' +
    '.pt-box button{padding:.42rem .8rem;border-radius:8px;border:1px solid rgba(245,241,232,.22);background:rgba(255,255,255,.05);' +
      'color:#f5f1e8;font:600 .8rem Karla,system-ui,sans-serif;cursor:pointer}' +
    '.pt-box button.pt-save{background:#fcd116;color:#141006;border-color:#fcd116}' +
    '.pt-box .pt-msg{font-size:.78rem;color:#958d7d;margin-left:auto}' +
    '.pt-box .pt-msg.err{color:#ef4444}' +
    '.pt-note{font-size:.74rem;color:#958d7d;margin:.55rem 0 0}';

  function el(html){ var d = document.createElement('div'); d.innerHTML = html; return d.firstChild; }
  var esc = function(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
    return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]; }); };

  var toggle = null, box = null, hot = null;

  function textAt(e){
    var node = null;
    if (document.caretPositionFromPoint) { var p = document.caretPositionFromPoint(e.clientX, e.clientY); node = p && p.offsetNode; }
    else if (document.caretRangeFromPoint) { var r = document.caretRangeFromPoint(e.clientX, e.clientY); node = r && r.startContainer; }
    if (node && node.nodeType === 3 && LETTER.test(node.nodeValue) && !skippable(node.parentElement)) return node;
    /* The pointer was on padding or an icon: take the first real text inside
       what was clicked. */
    var w = document.createTreeWalker(e.target, NodeFilter.SHOW_TEXT);
    var n; while ((n = w.nextNode())) { if (LETTER.test(n.nodeValue) && !skippable(n.parentElement)) return n; }
    return null;
  }

  function closeBox(){ if (box) { box.remove(); box = null; } }

  function openBox(target, x, y){
    closeBox();
    var slotEl = target.el && target.el.closest && target.el.closest('[data-slot]');
    var slot, original;
    if (slotEl) { slot = slotEl.getAttribute('data-slot'); original = slotEl.getAttribute('data-en') || slotEl.textContent; }
    else if (target.placeholder) { original = target.el.__ptOrigPh || target.el.getAttribute('placeholder'); slot = 'text:' + norm(original); }
    else {
      var node = target.node;
      if (node.__ptSet !== node.nodeValue) { node.__ptOrig = node.nodeValue; }
      original = node.__ptOrig || node.nodeValue;
      slot = 'text:' + keyFor(node, original);
      original = slot.slice(5);
    }
    var o = overrides[slot] || {};
    box = el('<div class="pt-box" data-pt-ui role="dialog" aria-label="Edit this text">' +
      '<h4>Edit this text</h4><p class="pt-orig">Originally: “' + esc(norm(original)) + '”</p>' +
      '<label>English</label><textarea class="pt-en">' + esc(o.en || norm(original)) + '</textarea>' +
      '<label>Amharic <span style="font-weight:400;color:#958d7d">(optional)</span></label><textarea class="pt-am" lang="am">' + esc(o.am || '') + '</textarea>' +
      '<p class="pt-note">Changes everywhere this exact wording appears on this page, for everyone.</p>' +
      '<div class="pt-row"><button type="button" class="pt-save">Save</button><button type="button" class="pt-reset">Back to original</button>' +
      '<button type="button" class="pt-cancel">Cancel</button><span class="pt-msg"></span></div></div>');
    document.body.appendChild(box);
    var bw = box.offsetWidth, bh = box.offsetHeight;
    box.style.left = Math.max(12, Math.min(x - bw / 2, window.innerWidth - bw - 12)) + 'px';
    box.style.top = Math.max(12, Math.min(y + 14, window.innerHeight - bh - 12)) + 'px';
    var en = box.querySelector('.pt-en'), am = box.querySelector('.pt-am'), msg = box.querySelector('.pt-msg');
    en.focus(); en.select();

    var save = async function(enV, amV){
      msg.className = 'pt-msg'; msg.textContent = 'Saving…';
      try {
        var res = await fetch(API + '/api/admin/page-text', { method:'POST', credentials:'include',
          headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ page:page, slot:slot, en:enV, am:amV }) });
        var d = null; try { d = await res.json(); } catch (_e) {}
        if (!res.ok) throw new Error((d && (d.detail || d.error)) || ('HTTP ' + res.status));
        if (!norm(enV) && !norm(amV)) delete overrides[slot];
        else overrides[slot] = { en: norm(enV) || null, am: norm(amV) || null };
        apply();
        closeBox();
      } catch (err) { msg.className = 'pt-msg err'; msg.textContent = 'Not saved: ' + err.message; }
    };
    box.querySelector('.pt-save').addEventListener('click', function(){
      /* Saving the original wording unchanged is the same as going back to it. */
      var v = norm(en.value), a = norm(am.value);
      if (v === norm(original) && !a) save('', ''); else save(v, a);
    });
    box.querySelector('.pt-reset').addEventListener('click', function(){ save('', ''); });
    box.querySelector('.pt-cancel').addEventListener('click', closeBox);
    box.addEventListener('keydown', function(e){
      if (e.key === 'Escape') closeBox();
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) box.querySelector('.pt-save').click();
    });
  }

  /* While editing, a click opens the editor and does nothing else: the
     capture phase sees it before any of the page's own handlers. */
  function onClick(e){
    if (!editing || inUi(e.target)) return;
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') && t.getAttribute('placeholder')) {
      openBox({ el:t, placeholder:true }, e.clientX, e.clientY); return;
    }
    var node = textAt(e);
    if (!node) return;
    openBox({ node:node, el:node.parentElement }, e.clientX, e.clientY);
  }
  function onOver(e){
    if (!editing || inUi(e.target)) return;
    if (hot) hot.classList.remove('pt-hot');
    hot = e.target && e.target.classList ? e.target : null;
    if (hot) hot.classList.add('pt-hot');
  }
  function block(e){ if (editing && !inUi(e.target)) { e.preventDefault(); e.stopPropagation(); } }

  function setEditing(on){
    editing = on;
    document.body.classList.toggle('pt-editing', on);
    toggle.classList.toggle('on', on);
    toggle.textContent = on ? '✎ Editing text · click any wording' : '✎ Edit text';
    if (!on) { closeBox(); if (hot) { hot.classList.remove('pt-hot'); hot = null; } }
  }

  async function offerEditing(){
    try {
      var res = await fetch(API + '/api/me', { credentials:'include' });
      if (!res.ok) return;
      var me = await res.json();
      if (!me || !me.signedIn || me.tier !== 'manager') return;
    } catch (e) { return; }
    var st = document.createElement('style'); st.setAttribute('data-pt-ui', ''); st.textContent = css;
    document.head.appendChild(st);
    toggle = el('<button type="button" class="pt-toggle" data-pt-ui title="Change any wording on this page">✎ Edit text</button>');
    document.body.appendChild(toggle);
    toggle.addEventListener('click', function(){ setEditing(!editing); });
    document.addEventListener('click', onClick, true);
    document.addEventListener('mouseover', onOver, true);
    ['mousedown', 'pointerdown', 'submit', 'dblclick'].forEach(function(t){ document.addEventListener(t, block, true); });
    document.addEventListener('keydown', function(e){
      if (e.key === 'Escape' && editing && !box) setEditing(false);
    });
  }

  /* A page-view beacon, kept from v1 because this script already loads on
     every page. Fire-and-forget: analytics must never delay or break a page. */
  function beacon(){
    try {
      fetch(API + '/api/track', { method:'POST', credentials:'include', headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({ page: page }), keepalive: true }).catch(function(){});
    } catch (e) {}
  }

  window.ethiopiaPageText = { reapply: apply, page: page };
  function start(){ watch(); load(); offerEditing(); beacon(); }
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();
