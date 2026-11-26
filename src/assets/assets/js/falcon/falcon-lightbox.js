/*
 * Full-screen popup for the pictures and charts on /falcon/.
 *
 * Without this script a picture link opens the larger picture as a page of its own, and the charts
 * stand in the page at full size. With it, every element marked data-falcon-pop opens in one popup:
 *   <a href="large.webp" data-falcon-pop="group" data-w="1600" data-h="895">   a picture
 *   <button data-falcon-pop="group" data-pop-target="id">                     a copy of the element with that id
 * Elements with the same group name are shown one after the other.
 *
 * Close:       the close button, a click or tap outside the picture, Esc, or a swipe down.
 * Move:        the arrow buttons, the arrow keys, Home and End, or a swipe to the side.
 * Look closer: a picture that is shown smaller than it is gets a button under it, "See it at full size".
 *              A click or tap on the picture does the same.
 */
(function () {
  'use strict';

  var root = document.documentElement;
  if (typeof document.createElement('dialog').showModal !== 'function') {
    root.classList.remove('falcon-js');                      // the charts stay in the page at full size
    return;
  }

  var ICON = { close: 'M6 6l12 12M18 6L6 18', prev: 'M15 5l-7 7 7 7', next: 'M9 5l7 7-7 7' };

  var triggers = Array.prototype.slice.call(document.querySelectorAll('[data-falcon-pop]')).filter(function (t) {
    var id = t.getAttribute('data-pop-target');
    return id ? !!document.getElementById(id) : !!t.href;
  });
  if (!triggers.length) return;

  var dialog = null, count, stage, caption, capTitle, capText, sizeBtn, closeBtn;
  var group = [], index = 0, opener = null, slide = null, picture = null;
  var zoomed = false, canZoom = false, loadToken = 0, touch = null, bodyPad = null, scrollY = 0;

  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text) n.textContent = text; return n; }

  function button(cls, label, path) {
    var b = el('button', 'falcon-pop__btn ' + cls);
    b.type = 'button';
    b.setAttribute('aria-label', label);
    b.innerHTML = '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">' +
      '<path d="' + path + '" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    return b;
  }

  function build() {
    if (dialog) return;
    dialog = el('dialog', 'falcon-pop');
    var bar = el('div', 'falcon-pop__bar');
    var prevBtn = button('falcon-pop__prev', 'Previous', ICON.prev);
    var nextBtn = button('falcon-pop__next', 'Next', ICON.next);
    count = el('p', 'falcon-pop__count');
    closeBtn = button('falcon-pop__close', 'Close', ICON.close);
    closeBtn.setAttribute('autofocus', '');
    bar.appendChild(prevBtn); bar.appendChild(count); bar.appendChild(nextBtn); bar.appendChild(closeBtn);
    stage = el('div', 'falcon-pop__stage');
    caption = el('div', 'falcon-pop__caption');
    caption.setAttribute('aria-live', 'polite');
    caption.setAttribute('aria-atomic', 'true');
    capTitle = el('p', 'falcon-pop__title');
    capText = el('p', 'falcon-pop__text');
    caption.appendChild(capTitle); caption.appendChild(capText);
    sizeBtn = el('button', 'falcon-pop__size');
    sizeBtn.type = 'button';
    var foot = el('div', 'falcon-pop__foot');
    foot.appendChild(caption); foot.appendChild(sizeBtn);
    dialog.appendChild(bar); dialog.appendChild(stage); dialog.appendChild(foot);
    document.body.appendChild(dialog);

    prevBtn.addEventListener('click', function () { step(-1); });
    nextBtn.addEventListener('click', function () { step(1); });
    closeBtn.addEventListener('click', close);
    sizeBtn.addEventListener('click', function () { toggleZoom(); });
    dialog.addEventListener('click', onClick);
    dialog.addEventListener('keydown', onKey);
    dialog.addEventListener('close', onClosed);
    dialog.addEventListener('touchstart', onTouchStart, { passive: true });
    dialog.addEventListener('touchend', onTouchEnd, { passive: true });
    dialog.addEventListener('touchcancel', function () { touch = null; }, { passive: true });
  }

  // ------------------------------------------------------------------ what a trigger shows
  function describe(t) {
    if (t.falconSlide) return t.falconSlide;
    var s, id = t.getAttribute('data-pop-target');
    if (id) {
      var name = t.querySelector('b');
      s = { kind: 'copy', source: document.getElementById(id), title: name ? name.textContent.trim() : '', text: '' };
    } else {
      var fig = t.closest('figure'), cap = fig ? fig.querySelector('figcaption') : null, thumb = t.querySelector('img');
      s = {
        kind: 'picture', href: t.href,
        w: Number(t.getAttribute('data-w')) || 0, h: Number(t.getAttribute('data-h')) || 0,
        thumb: thumb ? (thumb.currentSrc || thumb.src) : '', alt: thumb ? thumb.alt : '',
        title: cap && cap.children[0] ? cap.children[0].textContent.trim() : '',
        text: cap && cap.children[1] ? cap.children[1].textContent.trim() : ''
      };
    }
    t.falconSlide = s;
    return s;
  }

  // ------------------------------------------------------------------ open, move, close
  function open(t) {
    build();
    var name = t.getAttribute('data-falcon-pop');
    group = triggers.filter(function (x) { return x.getAttribute('data-falcon-pop') === name; });
    opener = t;
    dialog.classList.toggle('falcon-pop--single', group.length < 2);
    lock();
    dialog.showModal();
    show(group.indexOf(t));
    window.addEventListener('resize', fit);
  }

  function close() { if (dialog && dialog.open) dialog.close(); }

  function onClosed() {
    window.removeEventListener('resize', fit);
    unlock();
    stage.textContent = '';
    picture = null; slide = null; zoomed = false; touch = null; loadToken++;
    var back = opener;
    opener = null;
    if (back && back.focus) { try { back.focus({ preventScroll: true }); } catch (e) { back.focus(); } }
  }

  // The page behind must not scroll, and must not shift when its scrollbar goes away.
  function lock() {
    var gap = window.innerWidth - root.clientWidth;
    scrollY = window.pageYOffset;
    if (gap > 0) {
      bodyPad = document.body.style.paddingRight;
      document.body.style.paddingRight = ((parseFloat(window.getComputedStyle(document.body).paddingRight) || 0) + gap) + 'px';
    }
    root.classList.add('falcon-pop-open');
  }

  function unlock() {
    root.classList.remove('falcon-pop-open');
    if (bodyPad !== null) { document.body.style.paddingRight = bodyPad; bodyPad = null; }
    if (Math.abs(window.pageYOffset - scrollY) > 1) window.scrollTo({ top: scrollY, behavior: 'instant' });
  }

  function step(d) { if (group.length > 1) show(index + d); }

  function show(i) {
    var n = group.length;
    index = ((i % n) + n) % n;
    slide = describe(group[index]);
    zoomed = false; picture = null; loadToken++;
    stage.textContent = '';
    stage.className = 'falcon-pop__stage';
    stage.scrollTop = 0; stage.scrollLeft = 0;
    count.textContent = (index + 1) + ' of ' + n;
    dialog.setAttribute('aria-label', slide.title || 'Larger view');
    capTitle.textContent = slide.title;
    capText.textContent = slide.text;
    capText.hidden = !slide.text;
    sizeBtn.hidden = true;
    if (slide.kind === 'copy') showCopy(slide); else showPicture(slide);
  }

  // ------------------------------------------------------------------ a picture
  function showPicture(s) {
    var token = loadToken;
    caption.className = 'falcon-pop__caption';
    picture = el('img', 'falcon-pop__img');
    picture.alt = s.alt;
    picture.draggable = false;
    picture.src = s.thumb || s.href;                         // the small picture is already loaded: show it at once
    stage.appendChild(picture);
    fit();
    var big = new Image();
    big.onload = function () {
      if (token !== loadToken || !picture) return;
      if (!s.w || !s.h) { s.w = big.naturalWidth; s.h = big.naturalHeight; }
      picture.src = s.href;
      fit();
      preload(index + 1); preload(index - 1);
    };
    big.src = s.href;
  }

  function preload(i) {
    var n = group.length, t = group[((i % n) + n) % n];
    if (t && t.href && !t.getAttribute('data-pop-target')) { var im = new Image(); im.src = t.href; }
  }

  // Size the picture to the room there is, never larger than it is. Zoomed, it is shown as it is.
  function fit() {
    if (!dialog || !dialog.open || !picture || !slide || !slide.w || !slide.h) return;
    stage.classList.remove('is-zoomed');
    var cs = window.getComputedStyle(stage);
    var aw = Math.max(40, stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight));
    var ah = Math.max(40, stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom));
    var s = Math.min(aw / slide.w, ah / slide.h, 1);
    canZoom = s < 0.97;
    if (!canZoom) zoomed = false;
    if (zoomed) s = 1;
    picture.style.width = Math.round(slide.w * s) + 'px';
    picture.style.height = Math.round(slide.h * s) + 'px';
    picture.classList.toggle('can-zoom', canZoom && !zoomed);
    stage.classList.toggle('is-zoomed', zoomed);
    sizeBtn.hidden = !canZoom;
    sizeBtn.textContent = zoomed ? 'Fit it to the screen' : 'See it at full size';
  }

  // x and y are where the picture was clicked. From the button there is no such point: the middle is used.
  function toggleZoom(x, y) {
    if (!picture || (!canZoom && !zoomed)) return;
    var r = picture.getBoundingClientRect(), sr = stage.getBoundingClientRect();
    if (typeof x !== 'number') { x = sr.left + sr.width / 2; y = sr.top + sr.height / 2; }
    var fx = r.width ? Math.min(1, Math.max(0, (x - r.left) / r.width)) : 0.5;
    var fy = r.height ? Math.min(1, Math.max(0, (y - r.top) / r.height)) : 0.5;
    zoomed = !zoomed;
    fit();
    if (zoomed) {                                            // keep that point where it was on the screen
      stage.scrollLeft = picture.offsetLeft + fx * picture.offsetWidth - (x - sr.left);
      stage.scrollTop = picture.offsetTop + fy * picture.offsetHeight - (y - sr.top);
    }
  }

  // ------------------------------------------------------------------ a copy of something in the page (a chart)
  function showCopy(s) {
    caption.className = 'falcon-pop__caption sr-only';      // the chart carries its own title
    stage.classList.add('falcon-pop__stage--copy');
    var panel = el('div', 'falcon-pop__panel');
    var copy = s.source.cloneNode(true);
    copy.removeAttribute('id');
    Array.prototype.forEach.call(copy.querySelectorAll('[id]'), function (n) { n.removeAttribute('id'); });
    panel.appendChild(copy);
    var cells = copy.querySelectorAll('td[title]');
    if (cells.length) {
      var readout = el('p', 'falcon-pop__readout', 'Point at a square, or tap it, to read it.');
      var on = null;
      var read = function (ev) {
        var c = ev.target.closest ? ev.target.closest('td[data-read]') : null;
        if (!c || c === on) return;
        if (on) on.classList.remove('is-on');
        on = c;
        c.classList.add('is-on');
        readout.textContent = c.getAttribute('data-read');
      };
      Array.prototype.forEach.call(cells, function (c) { c.setAttribute('data-read', c.title); c.removeAttribute('title'); });
      copy.addEventListener('pointerover', read);
      copy.addEventListener('click', read);
      panel.appendChild(readout);
    }
    stage.appendChild(panel);
  }

  // ------------------------------------------------------------------ mouse, keyboard, touch
  function onClick(ev) {
    var t = ev.target;
    if (picture && t === picture) { toggleZoom(ev.clientX, ev.clientY); return; }
    if (t.closest && t.closest('button, .falcon-pop__panel, .falcon-pop__foot p')) return;
    close();                                                 // anywhere outside the picture
  }

  function onKey(ev) {
    if (ev.altKey || ev.ctrlKey || ev.metaKey) return;
    var k = ev.key;
    if (zoomed && (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'ArrowUp' || k === 'ArrowDown')) {
      stage.scrollBy(k === 'ArrowLeft' ? -120 : k === 'ArrowRight' ? 120 : 0, k === 'ArrowUp' ? -120 : k === 'ArrowDown' ? 120 : 0);
    } else if (k === 'ArrowLeft') step(-1);
    else if (k === 'ArrowRight') step(1);
    else if (k === 'Home') show(0);
    else if (k === 'End') show(group.length - 1);
    else return;
    ev.preventDefault();
  }

  function onTouchStart(ev) {
    touch = ev.touches.length === 1 ? { x: ev.touches[0].clientX, y: ev.touches[0].clientY, t: Date.now() } : null;
  }

  function onTouchEnd(ev) {
    var start = touch;
    touch = null;
    if (!start || ev.touches.length || zoomed || Date.now() - start.t > 700) return;
    if (window.visualViewport && window.visualViewport.scale > 1.02) return;   // the reader has pinched in: leave the gesture alone
    var end = ev.changedTouches[0], dx = end.clientX - start.x, dy = end.clientY - start.y;
    if (Math.abs(dx) > 48 && Math.abs(dx) > 1.5 * Math.abs(dy)) step(dx < 0 ? 1 : -1);
    else if (dy > 72 && dy > 1.5 * Math.abs(dx) && stage.scrollHeight <= stage.clientHeight + 1) close();
  }

  document.addEventListener('click', function (ev) {
    if (ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
    var t = ev.target.closest ? ev.target.closest('[data-falcon-pop]') : null;
    if (!t || triggers.indexOf(t) < 0) return;
    ev.preventDefault();
    open(t);
  });
})();
