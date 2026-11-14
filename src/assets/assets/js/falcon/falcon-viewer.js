/*
 * Viewer for the FALCON node on /falcon/.
 *
 * Without this script the page shows five still pictures, each with numbered parts and a list.
 * With it the pictures become tabs, a number and its list entry light up together, and
 * "Turn it round in 3D" loads three.js and the model on request (they are not loaded before that).
 *
 * The stills and the positions of the numbers are made from the same model by
 * scripts/render-falcon-stills.js, through the `falconViewer` handle set near the end of this file.
 */
(function () {
  'use strict';

  var root = document.querySelector('[data-falcon-viewer]');
  if (!root) return;
  var figures = Array.prototype.slice.call(root.querySelectorAll('[data-view]'));
  if (!figures.length) return;

  var tallQuery = window.matchMedia('(max-width: 620px)');
  var calmQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  var ids = figures.map(function (f) { return f.getAttribute('data-view'); });
  var figureOf = {}, tabOf = {};
  figures.forEach(function (f) { figureOf[f.getAttribute('data-view')] = f; });
  var current = ids[0];
  var engine = null;                                         // set once the 3D model is running
  var starting = null;                                       // promise while it loads

  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text) n.textContent = text; return n; }
  function variant() { return tallQuery.matches ? 'tall' : 'wide'; }
  function stageOf(id) { return figureOf[id].querySelector('.falcon-stage'); }

  // ------------------------------------------------------------------ tabs
  var tablist = el('div', 'falcon-tabs');
  tablist.setAttribute('role', 'tablist');
  tablist.setAttribute('aria-label', root.getAttribute('data-tabs-label') || 'Views of the node');
  figures.forEach(function (fig) {
    var id = fig.getAttribute('data-view');
    var tab = el('button', 'falcon-tab', fig.getAttribute('data-tab') || id);
    tab.type = 'button'; tab.id = 'node-tab-' + id;
    tab.setAttribute('role', 'tab'); tab.setAttribute('aria-controls', fig.id);
    tab.addEventListener('click', function () { show(id, { hash: true }); });
    tablist.appendChild(tab); tabOf[id] = tab;
    fig.setAttribute('role', 'tabpanel'); fig.setAttribute('aria-labelledby', tab.id);
  });
  tablist.addEventListener('keydown', function (e) {
    var i = ids.indexOf(current), n = ids.length, to = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') to = (i + 1) % n;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') to = (i + n - 1) % n;
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = n - 1;
    if (to < 0) return;
    e.preventDefault(); show(ids[to], { hash: true }); tabOf[ids[to]].focus();
  });
  root.insertBefore(tablist, root.firstChild);

  // ------------------------------------------------------------------ controls that sit on the picture
  var controls = el('div', 'falcon-controls');
  var startButton = el('button', 'falcon-3d-button', root.getAttribute('data-3d-label') || 'Turn it round in 3D');
  startButton.type = 'button';
  var zoom = el('div', 'falcon-zoom'); zoom.hidden = true;
  function zoomButton(label, text, fn) {
    var b = el('button', 'falcon-zoom-button', text); b.type = 'button'; b.setAttribute('aria-label', label);
    b.addEventListener('click', fn); zoom.appendChild(b); return b;
  }
  zoomButton('Zoom out', '−', function () { if (engine) engine.zoomBy(1.18); });
  zoomButton('Zoom in', '+', function () { if (engine) engine.zoomBy(1 / 1.18); });
  zoomButton('Back to the starting view', 'Reset', function () { if (engine) engine.reset(); }).classList.add('falcon-zoom-reset');
  controls.appendChild(startButton); controls.appendChild(zoom);
  var status = el('p', 'falcon-status'); status.setAttribute('role', 'status');
  var chip = el('p', 'falcon-chip'); chip.setAttribute('aria-hidden', 'true'); chip.hidden = true;
  var hint = el('p', 'falcon-hint', 'Drag to turn it. Use + and − to zoom.'); hint.id = 'falcon-hint'; hint.hidden = true;
  // Read out with the model by screen readers; keyboard users get the same controls as the mouse.
  var keys = el('p', 'sr-only', 'Drag, or use the arrow keys, to turn the model. Plus and minus zoom. Zero goes back to the starting view.'); keys.id = 'falcon-keys';
  root.appendChild(keys);

  startButton.addEventListener('click', function () {
    start().then(function () { engine.canvas.focus({ preventScroll: true }); }, function () {});
  });

  // ------------------------------------------------------------------ showing a view
  function show(id, opts) {
    if (!figureOf[id]) return;
    opts = opts || {};
    var changed = id !== current;
    current = id;
    ids.forEach(function (k) {
      var on = k === id;
      figureOf[k].hidden = !on;
      tabOf[k].setAttribute('aria-selected', on ? 'true' : 'false');
      tabOf[k].tabIndex = on ? 0 : -1;
    });
    var stage = stageOf(id);
    stage.appendChild(controls); stage.appendChild(status); stage.appendChild(chip); stage.appendChild(hint);
    pin(null);
    if (engine) engine.enter(id, opts.instant || !changed);
    if (opts.hash && window.history && history.replaceState) {
      try { history.replaceState(null, '', '#' + figureOf[id].id); } catch (err) { /* some embedded frames refuse it; the view has changed all the same */ }
    }
  }

  // ------------------------------------------------------------------ a number and its list entry light up together
  var hovered = null, pinned = null;
  function mark() {
    var fig = figureOf[current], active = hovered || pinned;
    Array.prototype.forEach.call(fig.querySelectorAll('[data-callout]'), function (n) {
      n.classList.toggle('is-active', n.getAttribute('data-callout') === active);
    });
    var entry = active && fig.querySelector('.falcon-legend [data-callout="' + active + '"]');
    if (entry) {
      var all = Array.prototype.slice.call(fig.querySelectorAll('.falcon-legend [data-callout]'));
      var name = entry.querySelector('b');
      chip.textContent = (all.indexOf(entry) + 1) + '  ' + (name ? name.textContent.replace(/\.\s*$/, '') : '');
    }
    chip.hidden = !entry;
  }
  function pin(id) { pinned = id; hovered = null; mark(); }
  function calloutAt(target) {
    var n = target && target.closest ? target.closest('[data-callout]') : null;
    return n && root.contains(n) ? n.getAttribute('data-callout') : null;
  }
  root.addEventListener('pointerover', function (e) { if (e.pointerType === 'touch') return; var id = calloutAt(e.target); if (id !== hovered) { hovered = id; mark(); } });
  root.addEventListener('pointerleave', function () { if (hovered) { hovered = null; mark(); } });
  root.addEventListener('click', function (e) {
    var id = calloutAt(e.target);
    if (id) { pin(pinned === id ? null : id); return; }
    if (e.target.closest && e.target.closest('.falcon-stage') && !e.target.closest('button')) pin(null);
  });

  // ------------------------------------------------------------------ the 3D model, loaded on request
  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script'); s.src = src; s.async = true;
      s.onload = function () { resolve(); }; s.onerror = function () { reject(new Error('Could not load ' + src)); };
      document.head.appendChild(s);
    });
  }
  function start() {
    if (engine) return Promise.resolve(engine);
    if (starting) return starting;
    startButton.disabled = true; status.textContent = 'Loading the 3D model…';
    starting = (window.THREE ? Promise.resolve() : loadScript(root.getAttribute('data-three')))
      .then(function () { return window.buildFalconNode ? null : loadScript(root.getAttribute('data-model')); })
      .then(function () {
        engine = createEngine(window.THREE, window.buildFalconNode(window.THREE));
        engine.enter(current, true);
        root.classList.add('is-3d');
        startButton.hidden = true; zoom.hidden = false; hint.hidden = false; status.textContent = '';
        return engine;
      })
      .catch(function (err) {
        starting = null; engine = null; startButton.disabled = false;
        root.classList.remove('is-3d');
        status.textContent = '3D did not start in this browser. The pictures show the same views.';
        if (window.console) console.warn('FALCON viewer:', err);
        throw err;
      });
    return starting;
  }

  function createEngine(THREE, model) {
    var canvas = el('canvas', 'falcon-canvas');
    canvas.tabIndex = 0; canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-describedby', 'falcon-keys');
    var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.setClearColor(0x000000, 0);
    var scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f84, 0.95));
    var sun = new THREE.DirectionalLight(0xffffff, 0.85); sun.position.set(260, 520, 480); scene.add(sun);
    var fill = new THREE.DirectionalLight(0xffffff, 0.3); fill.position.set(-320, 160, -260); scene.add(fill);
    scene.add(model.root);
    var camera = new THREE.PerspectiveCamera(30, 4 / 3, 10, 14000);
    var probe = camera.clone();                               // used to work out where the numbers stand in space

    var pose = null, home = null, lid = 1, view = null, vkey = null, stage = null;
    var labels = [], queued = false, anim = null;
    var v3 = new THREE.Vector3();

    function place(cam, p) {
      cam.position.set(p.t[0] + p.d * Math.sin(p.ph) * Math.sin(p.th), p.t[1] + p.d * Math.cos(p.ph), p.t[2] + p.d * Math.sin(p.ph) * Math.cos(p.th));
      cam.lookAt(p.t[0], p.t[1], p.t[2]); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
    }
    function copy(p) { return { t: p.t.slice(), th: p.th, ph: p.ph, d: p.d }; }
    function setLid(v) {
      lid = v;
      var shown = v > 0.004;
      model.lidAsm.visible = shown; model.ties.visible = shown;
      model.faders.forEach(function (m) { m.transparent = v < 0.996; m.opacity = v; });
    }
    function setMode(mode) { model.scenery.visible = mode === 'place'; model.pad.visible = mode !== 'place'; }

    // Each number stands at a point in space beside the model: the spot that falls on its designed place
    // in the starting view, at the same depth as the part it names. Turning the model carries it along.
    function buildLabels() {
      var list = model.callouts[view] || [], p = model.views[view][vkey];
      probe.aspect = camera.aspect; place(probe, p);
      var fig = figureOf[view];
      labels = list.map(function (c) {
        var at = new THREE.Vector3(c.at[0], c.at[1], c.at[2]);
        var depth = at.clone().project(probe).z;
        var spot = new THREE.Vector3(c[vkey][0] / 50 - 1, 1 - c[vkey][1] / 50, depth).unproject(probe);
        return {
          id: c.id, at: at, spot: spot,
          item: fig.querySelector('.falcon-markers [data-callout="' + c.id + '"]'),
          line: fig.querySelector('.falcon-leaders--' + vkey + ' [data-callout="' + c.id + '"]')
        };
      });
    }
    function percent(point) {
      v3.copy(point).project(camera);
      return [Math.round((v3.x + 1) * 500) / 10, Math.round((1 - v3.y) * 500) / 10];
    }
    function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
    function layout() {
      return labels.map(function (l) {
        var a = percent(l.at), s = percent(l.spot);
        return { id: l.id, ax: a[0], ay: a[1], lx: clamp(s[0], 4, 96), ly: clamp(s[1], 4, 96) };
      });
    }
    function drawLabels() {
      var k = vkey === 'tall' ? 't' : 'w';
      layout().forEach(function (p, i) {
        var l = labels[i];
        if (l.item) {
          l.item.style.setProperty('--' + k + 'x', p.lx + '%'); l.item.style.setProperty('--' + k + 'y', p.ly + '%');
          l.item.style.setProperty('--' + k + 'ax', p.ax + '%'); l.item.style.setProperty('--' + k + 'ay', p.ay + '%');
        }
        if (l.line) { l.line.setAttribute('x1', p.ax); l.line.setAttribute('y1', p.ay); l.line.setAttribute('x2', p.lx); l.line.setAttribute('y2', p.ly); }
      });
    }

    function fit() {
      if (!stage) return;
      var w = stage.clientWidth, h = stage.clientHeight;
      if (!w || !h) return;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
    }
    function draw() {
      queued = false;
      if (!pose) return;
      place(camera, pose);
      renderer.render(scene, camera);
      drawLabels();
    }
    function redraw() { if (!queued) { queued = true; requestAnimationFrame(step); } }
    function step(now) {
      if (anim) {
        var k = Math.min(1, (now - anim.start) / anim.ms), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        for (var i = 0; i < 3; i++) pose.t[i] = anim.from.t[i] + (anim.to.t[i] - anim.from.t[i]) * e;
        pose.th = anim.from.th + (anim.to.th - anim.from.th) * e;
        pose.ph = anim.from.ph + (anim.to.ph - anim.from.ph) * e;
        pose.d = anim.from.d + (anim.to.d - anim.from.d) * e;
        setLid(anim.lidFrom + (anim.lidTo - anim.lidFrom) * e);
        if (k >= 1) anim = null;
      }
      draw();
      if (anim) redraw();
    }
    function nearest(angle, ref) { var two = Math.PI * 2; return angle + Math.round((ref - angle) / two) * two; }
    function go(to, lidTo, instant) {
      if (instant || calmQuery.matches || !pose) {
        anim = null; pose = copy(to); setLid(lidTo); draw(); return;
      }
      var from = copy(pose); from.th = nearest(from.th, to.th);
      anim = { from: from, to: copy(to), lidFrom: lid, lidTo: lidTo, start: performance.now(), ms: 650 };
      pose = copy(from); redraw();
    }

    function enter(id, instant) {
      var moved = stage !== stageOf(id);
      view = id; vkey = variant(); stage = stageOf(id);
      if (moved) { stage.insertBefore(canvas, stage.firstChild); watcher.disconnect(); watcher.observe(stage); }
      fit();
      var v = model.views[id];
      home = copy(v[vkey]);
      setMode(v.mode);
      buildLabels();
      var title = figureOf[id].querySelector('h3');
      canvas.setAttribute('aria-label', '3D model of the node' + (title ? ': ' + title.textContent.trim() : ''));
      go(home, v.mode === 'inside' ? 0 : 1, instant);
    }

    // ---- turning and zooming
    function limit() {
      pose.ph = clamp(pose.ph, 0.12, 3.0);
      pose.d = clamp(pose.d, home.d * 0.4, home.d * 1.7);
    }
    function nudge(dth, dph, scale) {
      if (!pose) return;
      anim = null; setLid(model.views[view].mode === 'inside' ? 0 : 1);
      pose.th += dth; pose.ph += dph; pose.d *= scale || 1; limit(); redraw();
    }
    var touches = {}, pinch = 0;
    function count() { return Object.keys(touches).length; }
    function spread() { var k = Object.keys(touches); var a = touches[k[0]], b = touches[k[1]]; return Math.hypot(a.x - b.x, a.y - b.y); }
    canvas.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      touches[e.pointerId] = { x: e.clientX, y: e.clientY };
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* older browsers */ }
      if (count() === 2) pinch = spread();
      canvas.classList.add('is-turning'); hint.hidden = true;
    });
    canvas.addEventListener('pointermove', function (e) {
      var p = touches[e.pointerId]; if (!p) return;
      var dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
      if (count() === 1) nudge(-dx * 0.0075, -dy * 0.0075, 1);
      else if (count() === 2) { var s = spread(); if (pinch > 0 && s > 0) nudge(0, 0, pinch / s); pinch = s; }
    });
    function release(e) { delete touches[e.pointerId]; pinch = 0; if (!count()) canvas.classList.remove('is-turning'); }
    canvas.addEventListener('pointerup', release); canvas.addEventListener('pointercancel', release); canvas.addEventListener('lostpointercapture', release);
    canvas.addEventListener('wheel', function (e) {              // only with Ctrl or a trackpad pinch, so the page still scrolls
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault(); nudge(0, 0, Math.exp(clamp(e.deltaY, -60, 60) * 0.01));
    }, { passive: false });
    canvas.addEventListener('keydown', function (e) {
      var used = true;
      if (e.key === 'ArrowLeft') nudge(-0.14, 0, 1);
      else if (e.key === 'ArrowRight') nudge(0.14, 0, 1);
      else if (e.key === 'ArrowUp') nudge(0, -0.1, 1);
      else if (e.key === 'ArrowDown') nudge(0, 0.1, 1);
      else if (e.key === '+' || e.key === '=') nudge(0, 0, 1 / 1.18);
      else if (e.key === '-' || e.key === '_') nudge(0, 0, 1.18);
      else if (e.key === '0' || e.key === 'Home') go(home, model.views[view].mode === 'inside' ? 0 : 1, false);
      else used = false;
      if (used) { e.preventDefault(); hint.hidden = true; }
    });
    canvas.addEventListener('webglcontextlost', function (e) { e.preventDefault(); });
    canvas.addEventListener('webglcontextrestored', function () { redraw(); });

    var watcher = new ResizeObserver(function () { fit(); if (vkey !== variant()) enter(view, true); else { buildLabels(); draw(); } });
    function onVariant() { if (view) enter(view, true); }
    if (tallQuery.addEventListener) tallQuery.addEventListener('change', onVariant); else if (tallQuery.addListener) tallQuery.addListener(onVariant);

    return {
      canvas: canvas,
      enter: enter,
      layout: layout,
      zoomBy: function (s) { nudge(0, 0, s); },
      reset: function () { if (home) go(home, model.views[view].mode === 'inside' ? 0 : 1, false); },
      look: function (p, mode) { anim = null; labels = []; setMode(mode); home = copy(p); pose = copy(p); setLid(mode === 'inside' ? 0 : 1); draw(); },
      snapshot: function () { draw(); return canvas.toDataURL('image/png'); }
    };
  }

  // ------------------------------------------------------------------ start
  root.classList.add('is-enhanced');
  var wanted = (location.hash || '').replace(/^#node-/, '');
  show(figureOf[wanted] ? wanted : current, { instant: true });
  if (figureOf[wanted]) figureOf[wanted].scrollIntoView();
  window.addEventListener('hashchange', function () {
    var id = (location.hash || '').replace(/^#node-/, '');
    if (figureOf[id]) show(id);
  });

  // For scripts/render-falcon-stills.js: start 3D, jump to a view without animation, read where the numbers stand,
  // look from any other pose and take the picture off the canvas.
  root.falconViewer = {
    ready: function () { return start().then(function () { return true; }); },
    show: function (id) { show(id, { instant: true }); return new Promise(function (r) { requestAnimationFrame(function () { requestAnimationFrame(r); }); }); },
    layout: function () { return engine ? engine.layout() : []; },
    look: function (pose, mode) { engine.look(pose, mode || 'outside'); },
    snapshot: function () { return engine.snapshot(); },
    variant: variant
  };
})();
