/* ===========================================================================
   Ethiopia Ecosystem — shared chart  (v1)
   ---------------------------------------------------------------------------
   WHAT THIS REPLACES

   Four hand-rolled canvas renderers that had already drifted apart:
     treasury.html  drawChart()    one line, gradient fill, its own axis code
     growth.html    drawSeries()   n lines, shared min/max across all of them
     shop.html      drawSeries()   n lines, near-identical to growth's
     history.html   drawSpark()    small, gradient, no axis

   They were four copies of the same maths, so a fix to one never reached the
   others — growth and shop had already diverged on whether zero is forced onto
   the axis. One module means hover, touch and the axis rules are written once.

   WHY STILL CANVAS, AND STILL NO DEPENDENCY

   The original reasoning holds: a few lines on a dark ground do not justify
   200KB of charting library, and the site loads no third-party script at all.
   What was missing was never the drawing — it was the hit-testing.

   HOW HOVER WORKS WITHOUT DOM NODES

   A canvas has no elements to hover, so the pointer is hit-tested by hand:
   the plot geometry computed during the draw is kept, the pointer's x is
   turned back into a series index, and the nearest point wins.

   Two things make this cheap enough to run on every pointer move:

     - a SECOND canvas is stacked over the first and only that one is cleared
       and redrawn. Repainting the main chart per frame would redraw the
       gradient fill every time, which is the expensive part.
     - the tooltip is a real positioned <div>, not text drawn into the canvas,
       so it gets real fonts, real wrapping, and costs nothing to move.

   pointer* events rather than mouse*, so a finger works the same as a cursor —
   matching how shop.html's floor plan already handles input.
   =========================================================================== */
(function (global) {
  'use strict';

  var PALETTE = {
    green: '#189d4d', gold: '#edb912', red: '#cf2029', blue: '#2f6fb8',
    rule: '#2b2620', label: '#756c5d', text: '#f4efe4', ink: '#12100c',
  };

  var num = function (n) { return (Number(n) || 0).toLocaleString('en-US'); };

  /* Every live chart, so one resize listener serves the whole page instead of
     each page wiring its own debounced handler. */
  var charts = [];

  function cssVar(name, fallback) {
    try {
      var v = getComputedStyle(document.documentElement).getPropertyValue(name);
      return (v && v.trim()) || fallback;
    } catch (e) { return fallback; }
  }

  /* --- the overlay -------------------------------------------------------
     Created once per chart and reused. Appended to the canvas's own parent,
     which is made a positioning context if it is not one already — that way a
     page does not have to add CSS for this to work. */
  function ensureOverlay(canvas) {
    if (canvas._ethOverlay) return canvas._ethOverlay;

    var host = canvas.parentNode;
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';

    var over = document.createElement('canvas');
    over.className = 'eth-chart-overlay';
    over.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none';

    var tip = document.createElement('div');
    tip.className = 'eth-chart-tip';
    tip.style.cssText =
      'position:absolute;pointer-events:none;opacity:0;transition:opacity .1s ease;' +
      'background:rgba(18,16,12,.96);border:1px solid ' + cssVar('--rule', '#322c24') + ';' +
      'border-radius:' + cssVar('--r-sm', '6px') + ';padding:.45rem .6rem;' +
      'font-family:' + cssVar('--data', 'monospace') + ';font-size:.66rem;line-height:1.5;' +
      'white-space:nowrap;z-index:5;box-shadow:0 4px 14px rgba(0,0,0,.45)';

    host.appendChild(over);
    host.appendChild(tip);
    canvas._ethOverlay = { over: over, tip: tip };
    return canvas._ethOverlay;
  }

  function sizeTo(target, source) {
    var dpr = window.devicePixelRatio || 1;
    var w = source.clientWidth, h = source.clientHeight;
    target.style.width = w + 'px';
    target.style.height = h + 'px';
    target.width = w * dpr;
    target.height = h * dpr;
    var ctx = target.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx: ctx, w: w, h: h };
  }

  /* --- the draw ---------------------------------------------------------- */
/* The visible slice.
 *
 * chart.rows is always the full series; chart.view is the window onto it. Every
 * other function reads visibleRows() rather than chart.rows, so zooming is a
 * change to two numbers and nothing else has to know it happened. */
function visibleRows(chart) {
  var all = chart.rows || [];
  if (!chart.view) return all;
  return all.slice(chart.view.lo, chart.view.hi + 1);
}

function clampView(chart) {
  var n = (chart.rows || []).length;
  if (!chart.view) return;
  /* Four points is the floor. Below that a line chart stops being one — and
     it is also the point where zooming further tells you nothing a tooltip
     would not. */
  var minSpan = Math.min(4, n);
  if (chart.view.hi - chart.view.lo + 1 < minSpan) chart.view.hi = chart.view.lo + minSpan - 1;
  if (chart.view.lo < 0) { chart.view.hi -= chart.view.lo; chart.view.lo = 0; }
  if (chart.view.hi > n - 1) {
    chart.view.lo -= (chart.view.hi - (n - 1));
    chart.view.hi = n - 1;
  }
  if (chart.view.lo < 0) chart.view.lo = 0;
  if (chart.view.lo === 0 && chart.view.hi === n - 1) chart.view = null;   // back to all
}

  function draw(chart) {
    var canvas = chart.canvas, rows = visibleRows(chart), opts = chart.opts;
    var s = sizeTo(canvas, canvas);
    var ctx = s.ctx, w = s.w, h = s.h;
    ctx.clearRect(0, 0, w, h);

    var ov = ensureOverlay(canvas);
    sizeTo(ov.over, canvas);
    ov.over.getContext('2d').clearRect(0, 0, w, h);

    if (!rows || !rows.length) {
      ctx.fillStyle = PALETTE.label;
      ctx.font = '12px "Martian Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(opts.emptyText || 'Nothing recorded in this period', w / 2, h / 2);
      chart.geom = null;
      return;
    }

    var lines = opts.lines || [];
    var padL = opts.padL == null ? 54 : opts.padL;
    var padR = 12, padT = 14, padB = 26;

    var all = [];
    lines.forEach(function (l) {
      rows.forEach(function (r) { all.push(Number(r[l.key]) || 0); });
    });
    var min = Math.min.apply(null, all), max = Math.max.apply(null, all);

    /* Zero on the axis unless the data sits a long way from it. A count that
       never shows the floor turns a drop of five into a visual collapse —
       this was already the rule in three of the four originals, and the
       fourth disagreed. */
    if (opts.zeroBased === false) {
      if (min === max) { min -= 1; max += 1; }
    } else {
      if (min > 0 && min < max * 0.6) min = 0;
      if (min > 0 && opts.forceZero) min = 0;
      if (max < 0) max = 0;
      if (min === max) { min = Math.max(0, min - 1); max += 1; }
    }
    var span = max - min || 1;
    max += span * 0.08;

    var flat = rows.length === 1;
    var X = function (i) {
      return flat ? padL + (w - padL - padR) / 2
                  : padL + (i / Math.max(1, rows.length - 1)) * (w - padL - padR);
    };
    var Y = function (v) { return padT + (1 - (v - min) / (max - min)) * (h - padT - padB); };

    /* gridlines + value labels */
    ctx.strokeStyle = PALETTE.rule; ctx.lineWidth = 1;
    ctx.fillStyle = PALETTE.label; ctx.font = '10px "Martian Mono", monospace';
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (var g = 0; g <= 4; g++) {
      var v = min + (max - min) * (g / 4), yy = Math.round(Y(v)) + 0.5;
      ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(w - padR, yy); ctx.stroke();
      ctx.fillText(Math.round(v).toLocaleString('en-US'), padL - 8, yy);
    }

    /* a marked zero line, but only when the data actually crosses it */
    if (min < 0 && max > 0) {
      ctx.strokeStyle = '#7a1318'; ctx.setLineDash([3, 3]);
      var zy = Math.round(Y(0)) + 0.5;
      ctx.beginPath(); ctx.moveTo(padL, zy); ctx.lineTo(w - padR, zy); ctx.stroke();
      ctx.setLineDash([]);
    }

    /* optional gradient fill, for single-line charts where it reads as volume */
    if (opts.fill && lines.length === 1) {
      var c0 = lines[0].color;
      var grad = ctx.createLinearGradient(0, padT, 0, h - padB);
      grad.addColorStop(0, c0 + '33');
      grad.addColorStop(1, c0 + '00');
      ctx.beginPath();
      ctx.moveTo(X(0), Y(Number(rows[0][lines[0].key]) || 0));
      rows.forEach(function (r, i) { ctx.lineTo(X(i), Y(Number(r[lines[0].key]) || 0)); });
      ctx.lineTo(X(rows.length - 1), h - padB);
      ctx.lineTo(X(0), h - padB);
      ctx.closePath(); ctx.fillStyle = grad; ctx.fill();
    }

    lines.forEach(function (l) {
      ctx.strokeStyle = l.color; ctx.lineWidth = l.width || 1.8;
      ctx.lineJoin = 'round'; ctx.beginPath();
      rows.forEach(function (r, i) {
        var y = Y(Number(r[l.key]) || 0);
        if (i === 0) ctx.moveTo(X(i), y); else ctx.lineTo(X(i), y);
      });
      ctx.stroke();
      /* One reading is still a reading — draw it as a dot or it is invisible. */
      if (flat) {
        ctx.fillStyle = l.color;
        ctx.beginPath(); ctx.arc(X(0), Y(Number(rows[0][l.key]) || 0), 2.8, 0, Math.PI * 2);
        ctx.fill();
      }
    });

    /* First and last x label only — every label collides at 90 points. */
    var xf = opts.xFormat || function (r) { return String(r[opts.x || 'day'] || ''); };
    ctx.fillStyle = PALETTE.label; ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.fillText(xf(rows[0]), padL, h - padB + 8);
    if (rows.length > 1 && xf(rows[0]) !== xf(rows[rows.length - 1])) {
      ctx.textAlign = 'right';
      ctx.fillText(xf(rows[rows.length - 1]), w - padR, h - padB + 8);
    }

    /* Kept so the pointer handler can reuse the exact same maths rather than
       approximating it — an approximation here is a tooltip that names the
       wrong day. */
    /* Every plotted point, kept as drawn.
     *
     * The hover marker used to recompute its position from the row value,
     * which meant two code paths deciding where a point sits and nothing
     * forcing them to agree — so the dot drifted off the line. Reading back
     * the coordinates the line was actually drawn from makes that impossible
     * by construction. */
    var pts = {};
    lines.forEach(function (l) {
      pts[l.key] = rows.map(function (r, i) {
        return { x: X(i), y: Y(Number(r[l.key]) || 0) };
      });
    });

    chart.geom = { padL: padL, padR: padR, padT: padT, padB: padB, w: w, h: h,
                   X: X, Y: Y, flat: flat, pts: pts };
    chart.visible = rows;

    /* The window, announced so a page can show it or bind inputs to it. Fired
       on the canvas rather than returned, because the window changes from a
       wheel or a drag long after line() returned. */
    try {
      canvas.dispatchEvent(new CustomEvent('ethchart:range', {
        bubbles: true,
        detail: {
          lo: chart.view ? chart.view.lo : 0,
          hi: chart.view ? chart.view.hi : (chart.rows.length - 1),
          total: chart.rows.length,
          from: rows[0] || null,
          to: rows[rows.length - 1] || null,
          zoomed: !!chart.view,
        },
      }));
    } catch (_e) { /* CustomEvent unsupported — the chart still works */ }
  }

  /* --- hover ------------------------------------------------------------- */
  function indexAt(chart, clientX) {
    var g = chart.geom;
    if (!g) return -1;
    var r = chart.canvas.getBoundingClientRect();
    var x = clientX - r.left;
    if (x < g.padL - 12 || x > g.w - g.padR + 12) return -1;
    var rows = chart.visible || chart.rows;
    if (g.flat || rows.length === 1) return 0;
    var t = (x - g.padL) / (g.w - g.padL - g.padR);
    var i = Math.round(t * (rows.length - 1));
    return Math.max(0, Math.min(rows.length - 1, i));
  }

  function showAt(chart, i) {
    var ov = chart.canvas._ethOverlay;
    if (!ov || !chart.geom) return;
    var g = chart.geom, rows = chart.visible || chart.rows, opts = chart.opts;
    var ctx = ov.over.getContext('2d');
    ctx.clearRect(0, 0, g.w, g.h);

    if (i < 0) { ov.tip.style.opacity = '0'; chart.hover = -1; return; }
    chart.hover = i;

    var row = rows[i];
    /* The crosshair takes its x from the first plotted series for the same
       reason — one source of truth for where point i sits. */
    var firstKey = (opts.lines || [])[0] && (opts.lines || [])[0].key;
    var firstPts = g.pts && firstKey ? g.pts[firstKey] : null;
    var px = (firstPts && firstPts[i]) ? firstPts[i].x : g.X(i);

    /* crosshair */
    ctx.strokeStyle = 'rgba(244,239,228,.22)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(Math.round(px) + 0.5, g.padT);
    ctx.lineTo(Math.round(px) + 0.5, g.h - g.padB);
    ctx.stroke();
    ctx.setLineDash([]);

    /* White fill, ring in the line's own colour. Inverting it this way keeps
       the marker reading as a single bright point against a dark ground while
       still saying which series it belongs to — a solid white dot on every
       line would lose that the moment two series overlap. */
    var ys = [];
    (opts.lines || []).forEach(function (l) {
      /* Read back from what was plotted, never recomputed. g.Y(row[key]) and
         the line itself were two separate derivations of the same point, and
         any disagreement between them — a rounding difference, a stale geom
         after a resize — showed up as a dot floating beside its own line. */
      var p = g.pts && g.pts[l.key] && g.pts[l.key][i];
      if (!p) return;
      ys.push(p.y);
      ctx.beginPath(); ctx.arc(p.x, p.y, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff'; ctx.fill();
      ctx.lineWidth = 2.5; ctx.strokeStyle = l.color; ctx.stroke();
    });

    /* tooltip */
    var fmt = opts.format || num;
    var xf = opts.xFormat || function (r) { return String(r[opts.x || 'day'] || ''); };
    var html = '<div style="color:' + PALETTE.text + ';margin-bottom:.2rem">' +
      escapeHtml(xf(row)) + '</div>';
    (opts.lines || []).forEach(function (l) {
      html += '<div style="display:flex;gap:.5rem;align-items:center">' +
        '<i style="width:.5rem;height:.5rem;border-radius:999px;background:' + l.color +
        ';display:inline-block;flex:none"></i>' +
        '<span style="color:' + PALETTE.label + '">' + escapeHtml(l.label || l.key) + '</span>' +
        '<b style="margin-left:auto;color:' + PALETTE.text + ';font-variant-numeric:tabular-nums">' +
        escapeHtml(fmt(Number(row[l.key]) || 0, l.key)) + '</b></div>';
    });
    ov.tip.innerHTML = html;
    ov.tip.style.opacity = '1';

    /* Sits beside the marker rather than pinned to the top of the panel, so
       the reading and the point it describes are in one place and the eye
       does not have to travel between them.

       Anchored on the TOPMOST series, not the first one declared: with two
       lines the tooltip would otherwise sometimes cover the other one.

       Both axes are clamped to the canvas, and the horizontal flips to the
       left of the crosshair near the right edge, so it can never be clipped
       by the panel. */
    var tw = ov.tip.offsetWidth, th = ov.tip.offsetHeight;

    var left = px + 14;
    if (left + tw > g.w - 4) left = px - tw - 14;
    if (left < 4) left = 4;

    var anchorY = ys.length ? Math.min.apply(null, ys) : g.padT;
    var top = anchorY - th / 2;
    if (top < 4) top = 4;
    if (top + th > g.h - 4) top = g.h - th - 4;

    ov.tip.style.left = left + 'px';
    ov.tip.style.top = top + 'px';
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function wire(chart) {
    if (chart.wired) return;
    chart.wired = true;
    var canvas = chart.canvas;

    /* Coalesced to one update per frame. pointermove fires far faster than the
       screen can repaint, and the work per move is a full overlay redraw. */
    var queued = false, pendingX = 0;
    var onMove = function (e) {
      pendingX = e.clientX;
      if (queued) return;
      queued = true;
      requestAnimationFrame(function () {
        queued = false;
        showAt(chart, indexAt(chart, pendingX));
      });
    };

    canvas.style.touchAction = 'pan-y';   // let the page still scroll on touch
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerleave', function () { showAt(chart, -1); });
    canvas.addEventListener('pointercancel', function () { showAt(chart, -1); });

    if (chart.opts.zoom === false) {
      canvas.addEventListener('pointerdown', onMove);
      return;
    }

    /* --- zoom ------------------------------------------------------------
       Around the cursor, not the centre. Zooming to the middle means the thing
       you were looking at slides away as you zoom toward it, and you end up
       chasing it — the commonest way a zoomable chart feels broken.

       preventDefault only once the chart actually consumes the gesture, so a
       chart already showing everything still lets the page scroll past it
       rather than trapping the wheel. */
    canvas.addEventListener('wheel', function (e) {
      var n = (chart.rows || []).length;
      if (n < 6) return;
      var g = chart.geom;
      if (!g) return;

      var lo = chart.view ? chart.view.lo : 0;
      var hi = chart.view ? chart.view.hi : n - 1;
      var span = hi - lo + 1;
      var out = e.deltaY > 0;
      if (out && span >= n) return;          // already whole; let the page scroll

      e.preventDefault();

      var r = canvas.getBoundingClientRect();
      var t = (e.clientX - r.left - g.padL) / Math.max(1, g.w - g.padL - g.padR);
      t = Math.max(0, Math.min(1, t));
      var anchor = lo + t * (span - 1);

      var factor = out ? 1.25 : 0.8;
      var next = Math.max(4, Math.min(n, Math.round(span * factor)));
      chart.view = {
        lo: Math.round(anchor - t * (next - 1)),
        hi: Math.round(anchor + (1 - t) * (next - 1)),
      };
      clampView(chart);
      draw(chart);
      showAt(chart, indexAt(chart, e.clientX));
    }, { passive: false });

    /* --- pan -------------------------------------------------------------
       Dragging moves the window; a click without movement still reads as a
       hover. The three-pixel threshold is what separates them — without it
       every tap on a touchscreen registers as a one-pixel drag and the
       tooltip never opens. */
    var drag = null;
    canvas.addEventListener('pointerdown', function (e) {
      onMove(e);
      if (!chart.view || !chart.geom) return;
      drag = { x: e.clientX, lo: chart.view.lo, hi: chart.view.hi, moved: false };
      try { canvas.setPointerCapture(e.pointerId); } catch (_e) {}
    });
    canvas.addEventListener('pointermove', function (e) {
      if (!drag || !chart.geom) return;
      var g = chart.geom;
      var dx = e.clientX - drag.x;
      if (!drag.moved && Math.abs(dx) < 3) return;
      drag.moved = true;
      canvas.style.cursor = 'grabbing';
      var span = drag.hi - drag.lo + 1;
      var perPx = span / Math.max(1, g.w - g.padL - g.padR);
      var shift = Math.round(-dx * perPx);
      chart.view = { lo: drag.lo + shift, hi: drag.hi + shift };
      clampView(chart);
      draw(chart);
    });
    var endDrag = function () {
      if (drag && drag.moved) showAt(chart, -1);
      drag = null;
      canvas.style.cursor = '';
    };
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);

    /* Double-click is the universal "show me everything again". */
    canvas.addEventListener('dblclick', function (e) {
      e.preventDefault();
      chart.view = null;
      draw(chart);
      showAt(chart, -1);
    });
  }

  /* --- public ------------------------------------------------------------ */
  function line(canvas, rows, opts) {
    if (!canvas) return null;
    var existing = null;
    for (var i = 0; i < charts.length; i++) if (charts[i].canvas === canvas) existing = charts[i];

    var chart = existing || { canvas: canvas, hover: -1 };
    chart.rows = rows || [];
    chart.opts = opts || {};
    if (!existing) charts.push(chart);

    draw(chart);
    wire(chart);
    /* A redraw resets the overlay, so a tooltip left open over stale data can
       never survive into the new series. */
    showAt(chart, -1);
    return chart;
  }

  /* Drops charts whose canvas has left the document — these pages rebuild
     whole sections with innerHTML, so without this the array grows on every
     repaint and resize starts drawing into detached canvases. */
  function sweep() {
    charts = charts.filter(function (c) { return document.body.contains(c.canvas); });
  }

  function redrawAll() {
    sweep();
    charts.forEach(function (c) { draw(c); showAt(c, -1); });
  }

  var resizeTimer = null;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(redrawAll, 160);
  });

  /* Set the window from outside — what a pair of date inputs calls.
   *
   * Takes row PREDICATES rather than indices, because a page thinks in dates
   * and the chart thinks in positions, and whichever side does that
   * translation has to know the row shape. The page does. */
  function setRange(canvas, fromFn, toFn) {
    var chart = null;
    for (var i = 0; i < charts.length; i++) if (charts[i].canvas === canvas) chart = charts[i];
    if (!chart) return null;
    var rows = chart.rows || [];
    if (!rows.length) return null;

    var lo = 0, hi = rows.length - 1;
    if (typeof fromFn === 'function') {
      var a = rows.findIndex(fromFn);
      if (a >= 0) lo = a;
    }
    if (typeof toFn === 'function') {
      for (var j = rows.length - 1; j >= 0; j--) { if (toFn(rows[j])) { hi = j; break; } }
    }
    if (hi < lo) { var t = lo; lo = hi; hi = t; }
    chart.view = { lo: lo, hi: hi };
    clampView(chart);
    draw(chart);
    showAt(chart, -1);
    return chart.view;
  }

  function resetRange(canvas) {
    for (var i = 0; i < charts.length; i++) {
      if (charts[i].canvas === canvas) {
        charts[i].view = null;
        draw(charts[i]);
        showAt(charts[i], -1);
        return true;
      }
    }
    return false;
  }

  global.EthChart = {
    line: line,
    redrawAll: redrawAll,
    setRange: setRange,
    resetRange: resetRange,
    colors: PALETTE,
    /* Shared formatters, so "1,000g" is spelled the same on every page. */
    gold: function (n) { return num(n) + 'g'; },
    num: num,
  };
})(window);
