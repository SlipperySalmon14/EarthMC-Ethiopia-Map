/* ===========================================================================
   Editable page text
   ---------------------------------------------------------------------------
   Overrides wording that already exists in the HTML. Two rules:

     1. The page must read correctly BEFORE this runs, and if it never runs at
        all. Nothing here creates text; it only replaces it.
     2. It re-applies after the language toggle, because switching language
        re-reads data-en / data-am, which would otherwise undo an override.

   An element opts in with data-slot="name". The slot name is what an admin
   edits against, so it should describe the thing, not its current wording.
   =========================================================================== */
(function(){
  'use strict';

  var API = 'https://earthmc-ethiopia-proxy.ethiopianempire2.workers.dev';
  var page = (location.pathname.split('/').pop() || 'index.html').replace(/\.html$/, '') || 'index';
  var overrides = null;

  function currentLang(){
    return document.documentElement.getAttribute('data-lang') === 'am' ? 'am' : 'en';
  }

  function apply(){
    if (!overrides) return;
    var lang = currentLang();
    document.querySelectorAll('[data-slot]').forEach(function(el){
      var o = overrides[el.getAttribute('data-slot')];
      if (!o) return;
      // Fall back to English if only that has been written, rather than
      // blanking the element for Amharic readers.
      var text = (lang === 'am' ? o.am : o.en) || o.en || o.am;
      if (text) el.textContent = text;
    });
  }

  async function load(){
    try {
      var res = await fetch(API + '/api/page-text?page=' + encodeURIComponent(page),
        { credentials: 'include' });
      if (!res.ok) return;             // page keeps its built-in wording
      var data = await res.json();
      overrides = (data && data.text) || {};
      apply();
    } catch (e) { /* offline: built-in wording stands */ }
  }

  // The language buttons rewrite text from data-en/data-am, which would undo
  // an override. Re-apply on the next frame, after that has happened.
  document.addEventListener('click', function(e){
    var t = e.target;
    if (t && t.hasAttribute && t.hasAttribute('data-set-lang')) {
      requestAnimationFrame(apply);
    }
  });

  window.ethiopiaPageText = { reapply: apply, page: page };
  load();
})();
