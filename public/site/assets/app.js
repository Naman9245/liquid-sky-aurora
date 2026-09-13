/* =====================================================================
   LIQUID SKY — variant C behaviour
   ===================================================================== */
(function () {
  'use strict';

  var PHONE = '918792742988';
  var SWIGGY = 'https://www.swiggy.com/city/bangalore/liquid-sky-devanahalli-rest1333026';
  var DATA = window.LS_DATA || { items: [], reviews: [], themes: [] };
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var rupees = function (n) { return '₹' + n.toLocaleString('en-IN'); };
  var pad2 = function (n) { return (n < 10 ? '0' : '') + n; };

  /* ------------------------------------------------------------- THE API
     The 287 items ship inside this page, so the menu, the search and the
     cart all work with no server at all — open index.html off a USB stick
     and it still works. When the site is served by the Node backend the
     API supersedes that with live prices and, the part a guest actually
     cares about, what the kitchen has run out of tonight.

     Every call here is best-effort: a failure leaves the baked-in menu
     exactly as it was and the old WhatsApp path still runs. The site must
     never get *worse* because a server is down. */
  var API = { live: false };

  function apiFetch(path, opts) {
    opts = opts || {};
    if (!window.fetch) return Promise.reject(new Error('no fetch'));
    var ctl = ('AbortController' in window) ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, opts.timeout || 6000);
    return fetch(path, {
      method: opts.method || 'GET',
      headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      credentials: 'same-origin',
      cache: opts.cache || 'default',
      signal: ctl ? ctl.signal : undefined
    }).then(function (r) {
      clearTimeout(timer);
      return r.text().then(function (txt) {
        var json = {};
        try { json = txt ? JSON.parse(txt) : {}; } catch (e) { json = {}; }
        if (!r.ok) {
          var err = new Error(json.error || ('HTTP ' + r.status));
          err.status = r.status; err.body = json;
          throw err;
        }
        return json;
      });
    }, function (e) { clearTimeout(timer); throw e; });
  }

  /* "2026-09-12" + "8:30 PM" -> "2026-09-12T20:30:00+05:30".
     The offset is written explicitly rather than left to the device: a
     guest booking from a phone still set to another timezone would
     otherwise send a slot several hours off, and the server would either
     reject it as past or seat them at the wrong hour. */
  function slotISO(dateStr, timeStr) {
    var m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(String(timeStr || '').trim());
    if (!dateStr || !m) return null;
    var h = parseInt(m[1], 10) % 12;
    if (/PM/i.test(m[3])) h += 12;
    return dateStr + 'T' + pad2(h) + ':' + m[2] + ':00+05:30';
  }

  /* ------------------------------------------------------------------ SKY */
  (function initSky() {
    var canvas = $('sky');
    var sky = window.LiquidSky ? window.LiquidSky(canvas, {}) : null;
    if (!sky) {                       // no WebGL: keep the CSS dusk gradient
      canvas.style.display = 'none';
      return;
    }
    $('sky-fallback').style.display = 'none';
    sky.resize();

    var running = true, raf = 0;

    /* The canvas is fixed to the viewport, so it never scrolls away. It
       used to shade every pixel at 60fps for the whole session, and that
       cost is not just the shader: a dozen glass panels sit on top with
       backdrop-filter, and every repaint of the sky forces every one of
       them to re-blur. Two and a half megapixels of blur, sixty times a
       second, to animate something the guest is seeing through frosted
       glass while they read a menu.

       Throttling to 20fps helped and was still wrong. Below the hero the
       sky is STOPPED — a still frame, which lets the compositor keep the
       blurred results instead of rebuilding them. It restarts the moment
       the hero comes back, where the sky is the thing you are looking
       at and motion is the whole point. */
    var live = true, last = -1e9;
    function frame(ms) {
      raf = requestAnimationFrame(frame);
      if (!running || !live) return;
      if (ms - last < 16) return;
      last = ms;
      sky.draw(ms / 1000);
    }
    raf = requestAnimationFrame(frame);

    var hero = document.querySelector('.hero');
    if (hero && 'IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        live = entries[0].isIntersecting;
      }, { threshold: 0 }).observe(hero);
    }

    /* A full-viewport fragment shader is pure waste behind a hidden tab. */
    document.addEventListener('visibilitychange', function () {
      running = !document.hidden;
      if (running) { sky.refreshClock(); sky.resize(); }
    });
    var rt; window.addEventListener('resize', function () {
      clearTimeout(rt); rt = setTimeout(function () { sky.resize(); }, 120);
    });
    /* keep the sky honest as the evening actually passes */
    setInterval(function () { sky.refreshClock(); paintVeil(); }, 60000);
    window.__sky = sky;
    paintVeil();
  })();

  /* Veil weight by clock: brightest sky needs the most veil. Peaks at
     midday, bottoms out overnight when the sky is already dark. */
  function paintVeil() {
    var tod = (window.__sky && window.__sky.tod) != null
      ? window.__sky.tod
      : (window.LiquidSky ? window.LiquidSky.timeOfDay() : 0.8);
    var day = Math.max(0, Math.sin((tod - 0.22) * Math.PI / 0.56));   // 0 at night, 1 at noon
    var veil = 0.34 + 0.42 * day;                                     // .34 night -> .76 noon
    document.documentElement.style.setProperty('--veil', veil.toFixed(3));
  }
  paintVeil();
  setInterval(paintVeil, 60000);

  /* --------------------------------------------------- LIVE OPEN STATUS
     Open daily, closes 12:30 AM. Treat 00:00-00:30 as still open (it is
     the tail of the previous night's service), and 11:00 as the open. */
  function serviceState(now) {
    var d = now || new Date();
    var mins = d.getHours() * 60 + d.getMinutes();
    var OPEN = 11 * 60, CLOSE = 24 * 60 + 30;      // 11:00 -> 00:30
    var open = mins >= OPEN || mins < 30;
    var lastCall = open && (mins >= 23 * 60 + 30 || mins < 30);
    return { open: open, lastCall: lastCall };
  }
  function paintStatus() {
    var el = $('status'), txt = $('status-txt');
    if (!el) return;
    var s = serviceState();
    el.classList.toggle('is-shut', !s.open);
    txt.textContent = s.lastCall ? 'Last orders' : (s.open ? 'Open now' : 'Closed');
    el.title = s.open ? 'Open — kitchen closes 12:30 AM' : 'Closed — opens 11:00 AM';
  }
  paintStatus();
  setInterval(paintStatus, 60000);

  /* ------------------------------------------------------------ REVEALS */
  /* ------------------------------------------------------------ REVEALS
     `.reveal` starts at opacity 0 and only becomes visible when the
     observer adds `.is-in`. That makes any miss a CONTENT-INVISIBLE bug,
     not a missing animation — which is exactly what happened: this ran
     once at startup and observed the elements present then, but the plate
     cards and review quotes are injected afterwards by renderPlates() and
     renderQuotes(). They were never observed and stayed invisible; a
     reload "fixed" it only when a timing fallback happened to catch them.

     So: observe() is re-callable and every renderer calls it, plus a hard
     safety net that shows anything still hidden. Nothing may depend on an
     observer firing in order to be readable. */
  var revealIO = null;
  function observeReveals(root) {
    var items = (root || document).querySelectorAll('.reveal:not(.is-in)');
    if (!('IntersectionObserver' in window)) {
      Array.prototype.forEach.call(items, function (e) { e.classList.add('is-in'); });
      return;
    }
    if (!revealIO) {
      revealIO = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) { e.target.classList.add('is-in'); revealIO.unobserve(e.target); }
        });
      }, { rootMargin: '0px 0px -6% 0px', threshold: 0.02 });
    }
    Array.prototype.forEach.call(items, function (e) { revealIO.observe(e); });
  }

  /* Safety net. IntersectionObserver callbacks are throttled in a
     background tab, and rAF does not run there at all, so without this a
     visitor who opens the page in a background tab can return to a page
     of blank sections. Anything on screen gets shown regardless. */
  function forceRevealVisible() {
    var h = window.innerHeight || 800;
    document.querySelectorAll('.reveal:not(.is-in)').forEach(function (e) {
      var r = e.getBoundingClientRect();
      if (r.top < h * 1.2 && r.bottom > -h * 0.2) e.classList.add('is-in');
    });
  }
  observeReveals();
  window.addEventListener('scroll', forceRevealVisible, { passive: true });
  window.addEventListener('load', function () { observeReveals(); forceRevealVisible(); });
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) { observeReveals(); forceRevealVisible(); }
  });
  /* Periodic sweep + a hard backstop.

     This system has hidden real content twice now (injected cards that were
     never observed; then the 5s loader shifting the timing). The lesson is
     structural: an animation must never be the thing that decides whether
     text is readable. IntersectionObserver is throttled in background tabs
     and rAF does not run there at all, so neither can be the only path.

     So: sweep while the page settles, then after 10s reveal everything
     unconditionally. Someone who has not scrolled that far loses a fade-in
     on lower sections — a trade worth making against a blank page. */
  var sweeps = 0;
  var sweeper = setInterval(function () {
    observeReveals(); forceRevealVisible();
    if (++sweeps > 24) clearInterval(sweeper);        // ~10s at 400ms
  }, 400);
  setTimeout(function () {
    clearInterval(sweeper);
    document.querySelectorAll('.reveal:not(.is-in)').forEach(function (e) {
      e.classList.add('is-in');
    });
  }, 10000);

  /* --------------------------------------------------- PLATES & THE BAR */
  /* Every plate and every pour here is a real line on the real menu at its
     real price — verified against menu-data.js. The first pass invented
     five dishes ("Tandoori Platter ₹620", "Chicken Ghee Roast ₹360") that
     do not exist, which would have sent guests in asking for them by name.

     The photographs arrived cut out on transparency, so nothing is framed:
     a dish sits directly on the page over its own pool of light, and the
     glasses stand on a counter line with a reflection under them. Boxing a
     cut-out in a rectangle is the one thing that gives the trick away. */
  var PLATES = [
    { img:'kebab',   name:'Kalmi Kabab',               note:'Charcoal tandoor, bone-in, deeply spiced',      price:380, veg:false },
    { img:'biryani', name:'Tandoori Chicken Biriyani', note:'Dum-cooked, a whole charred leg on top',        price:349, veg:false },
    { img:'butter',  name:'Butter Chicken',            note:'Tomato, cream, and a long finish',              price:349, veg:false },
    { img:'chilli',  name:'Honey Chilly Chicken',      note:'Sticky and dark — the table-share order',       price:330, veg:false },
    { img:'paneer',  name:'Paneer Tikka',              note:'Off the same charcoal as the chicken',          price:299, veg:true  },
    { img:'noodles', name:'Chilly Garlic Noodles',     note:'Wok-tossed, burnt garlic, sliced peppers',      price:240, veg:true  },
    { img:'dal',     name:'Dal Punjabi',               note:'Slow black dal, finished with cream',           price:195, veg:true  },
    { img:'gulab',   name:'Gulab Jamun',               note:'Two, warm, in cardamom syrup',                  price:95,  veg:true  }
  ];

  var POURS = [
    { img:'mojito',     name:'Mojito',              kind:'Cocktail', note:'Mint, lime, crushed ice',        price:340 },
    { img:'cosmo',      name:'Cosmopolitan',        kind:'Cocktail', note:'Cranberry and citrus, straight up', price:340 },
    { img:'oldfash',    name:'Whiskey Sour',        kind:'Cocktail', note:'Whisky, lemon, over one big rock',  price:340 },
    { img:'longisland', name:'Long Island Ice Tea', kind:'Cocktail', note:'Five spirits. Sit down first.',  price:620 },
    { img:'bluelagoon', name:'Blue Sky',            kind:'Mocktail', note:'The one the name asks for',      price:220 }
  ];

  function shot(img, name, cls) {
    return '<img loading="lazy" decoding="async" class="' + cls + '" ' +
           'src="/site/photos/dish/' + img + '.webp" alt="' + esc(name) + '" />';
  }

  (function renderPlates() {
    var wrap = $('plates-grid'); if (!wrap) return;
    wrap.innerHTML = PLATES.map(function (p, i) {
      return '<article class="dish reveal" style="--delay:' + (i * 55) + 'ms">' +
        '<div class="dish-shot">' + shot(p.img, p.name, 'dish-img') + '</div>' +
        '<div class="dish-body">' +
          '<h3>' + esc(p.name) + '</h3>' +
          '<p>' + esc(p.note) + '</p>' +
          '<div class="dish-foot">' +
            '<span class="veg ' + (p.veg ? '' : 'is-non') + '" role="img" aria-label="' +
              (p.veg ? 'Vegetarian' : 'Non-vegetarian') + '"></span>' +
            '<span class="dish-price">' + rupees(p.price) + '</span>' +
            '<button class="btn btn--mini" data-add="' + esc(p.name) + '" data-price="' + p.price +
              '">Add</button>' +
          '</div>' +
        '</div></article>';
    }).join('');
    observeReveals(wrap);          // cards injected after the observer started
  })();

  (function renderPours() {
    var wrap = $('bar-rail'); if (!wrap) return;
    wrap.innerHTML = POURS.map(function (d, i) {
      return '<article class="pour reveal" style="--delay:' + (i * 70) + 'ms">' +
        '<div class="pour-shot">' + shot(d.img, d.name, 'pour-img') +
          '<span class="pour-reflect" aria-hidden="true">' +
            '<img loading="lazy" decoding="async" src="/site/photos/dish/' + d.img + '.webp" alt="" />' +
          '</span>' +
        '</div>' +
        '<div class="pour-body">' +
          '<span class="mono pour-kind">' + esc(d.kind) + '</span>' +
          '<h3>' + esc(d.name) + '</h3>' +
          '<p>' + esc(d.note) + '</p>' +
          '<div class="dish-foot">' +
            '<span class="pour-price">' + rupees(d.price) + '</span>' +
            '<button class="btn btn--mini" data-add="' + esc(d.name) + '" data-price="' + d.price +
              '">Add</button>' +
          '</div>' +
        '</div></article>';
    }).join('');
    observeReveals(wrap);
  })();

  /* -------------------------------------------------------------- MENU */
  var LABELS = { starters:'Starters', tandoor:'Tandoor', soups:'Soups', mains:'Mains',
    biryani:'Biryani', chinese:'Chinese', coastal:'Coastal', breads:'Breads', sides:'Sides',
    desserts:'Desserts', mocktails:'Mocktails', cocktails:'Cocktails', spirits:'Spirits' };
  var cats = [];
  DATA.items.forEach(function (it) { if (cats.indexOf(it[1]) < 0) cats.push(it[1]); });
  var activeCat = cats[0], query = '', diet = 'all';   /* all | veg | nonveg */

  /* ---- SEARCH INDEX -------------------------------------------------
     Two things make a naive name-only search fail badly on this menu:

     1. The kitchen's spellings are not the guest's. The menu says
        "Biriyani" and "Kabab"; guests — including this restaurant's own
        Google reviewers — type "biryani" and "kebab". Both returned zero.
     2. Twelve of the thirteen categories never contain their own word in
        any item name, so "dessert", "soup", "cocktail" and "starter" all
        returned zero while those sections sat right there.

     So each item is indexed against its name AND its category label, and
     queries are normalised through a small synonym map. Built once, not
     per keystroke — 287 regex passes on every key would feel sticky. */
  var SYNONYMS = [
    [/\bkebabs?\b/g, 'kabab'], [/\bkababs?\b/g, 'kabab'],
    [/\bbiry?ani\b/g, 'biriyani'], [/\bbiriyani\b/g, 'biriyani'],
    [/\bmocktails?\b/g, 'mocktail'], [/\bcocktails?\b/g, 'cocktail'],
    [/\bstarters?\b/g, 'starter'], [/\bdesserts?\b/g, 'dessert'],
    [/\bbreads?\b/g, 'bread'], [/\bsoups?\b/g, 'soup'],
    [/\bchickens?\b/g, 'chicken'], [/\bpaneers?\b/g, 'paneer'],
    [/\bveg\b/g, 'veg'], [/\bnon.?veg\b/g, 'chicken']
  ];
  function normalise(str) {
    var t = str.toLowerCase();
    for (var i = 0; i < SYNONYMS.length; i++) t = t.replace(SYNONYMS[i][0], SYNONYMS[i][1]);
    return t;
  }
  var INDEX = DATA.items.map(function (it) {
    return normalise(it[0] + ' ' + (LABELS[it[1]] || it[1]) + ' ' + it[1]);
  });

  function visible() {
    var out = [];
    for (var i = 0; i < DATA.items.length; i++) {
      var it = DATA.items[i];
      if (diet === 'veg'    && !it[3]) continue;
      if (diet === 'nonveg' &&  it[3]) continue;
      if (query) { if (INDEX[i].indexOf(query) < 0) continue; }
      else if (it[1] !== activeCat) continue;
      out.push(it);
    }
    return out;
  }
  function renderCats() {
    var w = $('cats'); if (!w) return;
    w.innerHTML = cats.map(function (c) {
      return '<button class="cat" type="button" role="tab" data-cat="' + esc(c) + '" aria-selected="' +
        (c === activeCat && !query ? 'true' : 'false') + '">' + esc(LABELS[c] || c) + '</button>';
    }).join('');
  }
  function renderMenu() {
    var list = $('menu-list'), empty = $('menu-empty'), count = $('menu-count');
    if (!list) return;
    var items = visible();
    if (count) count.textContent = items.length === DATA.items.length
      ? String(DATA.items.length) : items.length + ' of ' + DATA.items.length;
    if (empty) {
      empty.hidden = items.length > 0;
      /* The stock "try biryani or kebab" line is wrong advice when the
         thing hiding the results is the veg switch, not the spelling. */
      if (!items.length) {
        var side = diet === 'veg' ? 'vegetarian' : 'non-vegetarian';
        empty.textContent = diet === 'all'
          ? 'Nothing matches that. Try \u201cbiryani\u201d, \u201ckebab\u201d or \u201cmojito\u201d.'
          : (query
              ? 'No ' + side + ' dish matches that. Switch to All to see the rest.'
              : 'Nothing ' + side + ' in this section. Try another, or switch to All.');
      }
    }
    list.innerHTML = items.map(function (it) {
      /* it[4] is availability from the API. Undefined means we are running
         off the baked-in menu with no server, where everything is on. */
      var out = it[4] === false;
      var price = it[2] > 0
        ? '<span class="row-price">' + rupees(it[2]) + '</span>'
        : '<span class="row-price is-ask">Ask</span>';
      /* Sold out is stated in words, not just greyed out: colour alone
         would leave it invisible to a screen reader and to anyone who
         cannot pick the contrast difference. */
      var tail = out
        ? '<span class="row-out mono">Sold out</span>'
        : '<button class="row-add" type="button" data-add="' + esc(it[0]) + '" data-price="' + it[2] +
          '" aria-label="Add ' + esc(it[0]) + ' to your order">+</button>';
      return '<div class="row' + (out ? ' is-out' : '') + '">' +
        '<span class="veg ' + (it[3] ? '' : 'is-non') + '" role="img" aria-label="' +
          (it[3] ? 'Vegetarian' : 'Non-vegetarian') + '"></span>' +
        '<span class="row-name">' + esc(it[0]) + '</span>' + price + tail + '</div>';
    }).join('');
  }
  $('cats').addEventListener('click', function (e) {
    var b = e.target.closest('.cat'); if (!b) return;
    activeCat = b.getAttribute('data-cat'); query = ''; $('q').value = '';
    renderCats(); renderMenu();
  });
  var qt;
  $('q').addEventListener('input', function (e) {
    var v = e.target.value.trim().toLowerCase();
    clearTimeout(qt);
    qt = setTimeout(function () { query = v ? normalise(v) : ''; renderCats(); renderMenu(); }, 110);
  });
  /* ------------------------------------------- VEG / NON-VEG SWITCH ---
     Choosing a side rolls a clip from the kitchen over the list while it
     swaps underneath. Both clips run about five seconds, so each starts at
     its own best moment rather than from the top: the wok clip is dull
     until the flame catches at 3.4s and the vegetables go up at the end,
     and the grill clip does nothing until the flare-up just before 2s.
     Playing a window at normal speed beats speeding the whole thing up —
     2.7x on a five-second clip reads as a glitch, not as cooking. */
  var FILM = {
    veg:    { start: 3.40, run: 2000, label: 'Vegetarian' },
    nonveg: { start: 1.80, run: 3000, label: 'Non-vegetarian' }
  };
  var dietWrap = $('diet'), film = $('switch-film'), filmLabel = $('switch-label');
  var filmBusy = false, filmTimers = [];

  function reducedMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }
  function catHasAny(c) {
    for (var i = 0; i < DATA.items.length; i++) {
      var it = DATA.items[i];
      if (it[1] !== c) continue;
      if (diet === 'veg' && !it[3]) continue;
      if (diet === 'nonveg' && it[3]) continue;
      return true;
    }
    return false;
  }
  function paintDiet() {
    if (!dietWrap) return;
    var b = dietWrap.getElementsByTagName('button');
    for (var i = 0; i < b.length; i++) {
      b[i].setAttribute('aria-pressed', b[i].getAttribute('data-diet') === diet ? 'true' : 'false');
      b[i].removeAttribute('data-pending');
    }
  }
  function applyDiet(next) {
    diet = next;
    /* Breads, sides, desserts and the entire bar are vegetarian, so asking
       for non-veg from one of those would empty the list — a blank panel
       right after a three-second film reads as a bug. Move to the first
       category that still has something. */
    if (!query && !catHasAny(activeCat)) {
      for (var i = 0; i < cats.length; i++) {
        if (catHasAny(cats[i])) { activeCat = cats[i]; break; }
      }
    }
    paintDiet(); renderCats(); renderMenu();
  }
  function clearFilmTimers() {
    for (var i = 0; i < filmTimers.length; i++) clearTimeout(filmTimers[i]);
    filmTimers = [];
  }
  function activeVideo(kind) {
    if (!film) return null;
    var vids = film.getElementsByTagName('video'), found = null;
    for (var i = 0; i < vids.length; i++) {
      var on = vids[i].getAttribute('data-diet') === kind;
      vids[i].setAttribute('data-active', on ? 'true' : 'false');
      if (!on) { try { vids[i].pause(); } catch (e) {} }
      else found = vids[i];
    }
    return found;
  }
  /* One straight sequence — ready, seek, play, close — rather than a web of
     callbacks. The first version branched on readyState and started playing
     from loadedmetadata, where seeking is still unreliable: the clip rolled
     from 0.06s instead of 3.4s, and once it never started at all. Waiting
     for loadeddata costs a few frames and removes both failures. */
  function whenReady(v, cb) {
    if (v.readyState >= 2) { cb(true); return; }          // HAVE_CURRENT_DATA
    var settled = false;
    function done(ok) { if (!settled) { settled = true; cb(ok); } }
    var t = setTimeout(function () { done(false); }, 1500);
    filmTimers.push(t);
    v.addEventListener('loadeddata', function () { clearTimeout(t); done(true); }, { once: true });
    v.addEventListener('error',      function () { clearTimeout(t); done(false); }, { once: true });
    if (v.preload !== 'auto') { v.preload = 'auto'; try { v.load(); } catch (e) {} }
  }
  function seekTo(v, at, cb) {
    if (Math.abs(v.currentTime - at) < 0.08) { cb(); return; }
    var settled = false;
    function done() { if (!settled) { settled = true; cb(); } }
    var t = setTimeout(done, 500);        // a swallowed "seeked" must not hang the switch
    filmTimers.push(t);
    v.addEventListener('seeked', function () { clearTimeout(t); done(); }, { once: true });
    try { v.currentTime = at; } catch (e) { clearTimeout(t); done(); }
  }
  function rollFilm(kind, then) {
    var spec = FILM[kind], v = activeVideo(kind);
    if (!spec || !film || !v || reducedMotion()) { then(); return; }

    /* Drop anything still pending from the previous switch. Its backstops
       outlive its own close() by design, and a stale one firing inside a
       new roll would cut the film short. */
    clearFilmTimers();
    filmBusy = true;
    if (dietWrap) dietWrap.setAttribute('data-busy', 'true');
    filmLabel.textContent = spec.label;
    film.setAttribute('data-on', 'true');

    var closed = false, swapped = false;
    function swap() { if (!swapped) { swapped = true; then(); } }
    function close() {
      if (closed) return;
      closed = true;
      clearFilmTimers();
      swap();
      film.setAttribute('data-on', 'false');
      try { v.pause(); } catch (e) {}
      filmTimers.push(setTimeout(function () {
        filmBusy = false;
        if (dietWrap) dietWrap.removeAttribute('data-busy');
        try { v.currentTime = spec.start; } catch (e) {}    // park for next time
      }, 360));
    }
    /* Absolute ceiling, measured from the press and independent of the
       video clock — in a throttled tab the element may never advance, and
       the menu must never stay covered. */
    filmTimers.push(setTimeout(close, spec.run + 2200));

    whenReady(v, function (ok) {
      if (closed) return;
      /* Not buffered, or it errored. Hold the dark panel just long enough
         to read as a wipe instead of stalling on a blank rectangle. */
      if (!ok) { filmTimers.push(setTimeout(close, 420)); return; }
      seekTo(v, spec.start, function () {
        if (closed) return;
        var p = v.play();
        if (p && p.catch) p.catch(function () { filmTimers.push(setTimeout(close, 300)); });
        /* Counted from the moment playback is asked for, so the guest always
           sees the full two or three seconds of footage rather than the tail
           of a buffering wait. */
        filmTimers.push(setTimeout(close, spec.run));
      });
    });
  }
  if (dietWrap) {
    dietWrap.addEventListener('click', function (e) {
      var b = e.target.closest('[data-diet]'); if (!b) return;
      var next = b.getAttribute('data-diet');
      if (filmBusy || next === diet) return;
      if (next === 'all') { applyDiet('all'); return; }   /* nothing to celebrate */
      b.setAttribute('data-pending', 'true');              /* answer the tap now */
      rollFilm(next, function () { applyDiet(next); });
    });
  }
  /* 2.9MB of clips, so nothing is fetched until it is worth having. The
     IntersectionObserver alone was not enough — it is throttled, and more
     than once the menu had been on screen for two seconds with both
     elements still at readyState 0. Pointer or keyboard intent on the
     switch itself is the reliable signal; the observer and a late timer
     are backstops. */
  (function primeFilms() {
    if (!film) return;
    var vids = film.getElementsByTagName('video'), primed = false;
    function prime() {
      if (primed) return;
      primed = true;
      for (var i = 0; i < vids.length; i++) {
        (function (v) {
          var spec = FILM[v.getAttribute('data-diet')];
          function park() { if (spec) { try { v.currentTime = spec.start; } catch (e) {} } }
          v.preload = 'auto';
          /* load() resets the element, currentTime included. Parking first
             and calling load() after threw the position away again, which
             is why the veg clip kept rolling from zero. */
          if (v.readyState >= 1) park();
          else {
            v.addEventListener('loadeddata', park, { once: true });
            try { v.load(); } catch (e) {}
          }
        })(vids[i]);
      }
    }
    if (dietWrap) {
      dietWrap.addEventListener('pointerenter', prime);
      dietWrap.addEventListener('focusin', prime);
      dietWrap.addEventListener('touchstart', prime, { passive: true });
    }
    /* These two clips are 2.9MB together. They used to be fetched on a 9
       second timer and on the whole menu section coming within 400px,
       which meant nearly every visitor paid for them whether they ever
       touched the switch or not. Now the trigger is the switch itself
       coming into view, plus the pointer/focus intent above — and a cold
       first press degrades gracefully anyway, because rollFilm waits for
       the clip and falls back to a short wipe if it is not ready. */
    if (dietWrap && 'IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (entries) {
        for (var i = 0; i < entries.length; i++) {
          if (entries[i].isIntersecting) { prime(); io.disconnect(); return; }
        }
      }, { rootMargin: '80px' });
      io.observe(dietWrap);
    }
  })();

  /* ------------------------------------------------------------ REVIEWS */
  (function renderQuotes() {
    var w = $('quotes'); if (!w) return;
    w.innerHTML = (DATA.reviews || []).map(function (r, i) {
      return '<blockquote class="quote glass reveal" style="--delay:' + (i * 90) + 'ms">' +
        '<p>&ldquo;' + esc(r.t) + '&rdquo;</p>' +
        '<footer class="mono"><span>' + esc(r.a) + '</span><span>' + esc(r.m) + ' &middot; ' + esc(r.d) + '</span></footer>' +
      '</blockquote>';
    }).join('');
    observeReveals(w);             // same: injected after startup
  })();

  /* --------------------------------------------------------------- CART */
  var cart = [];
  function cartCount() { return cart.reduce(function (n, l) { return n + l.qty; }, 0); }
  function cartTotal() { return cart.reduce(function (n, l) { return n + l.qty * l.price; }, 0); }
  function renderCart() {
    var body = $('cart-body'), badge = $('cart-badge');
    var n = cartCount();
    badge.hidden = n === 0; badge.textContent = n;
    $('cart-total').textContent = rupees(cartTotal());
    body.innerHTML = cart.length ? cart.map(function (l, i) {
      return '<div class="line"><span>' + esc(l.name) + '<br><span class="mono">' + rupees(l.price) + '</span></span>' +
        '<span class="qty"><button data-dec="' + i + '" aria-label="One fewer">&minus;</button>' +
        '<span>' + l.qty + '</span>' +
        '<button data-inc="' + i + '" aria-label="One more">+</button></span>' +
        '<strong>' + rupees(l.qty * l.price) + '</strong></div>';
    }).join('') : '<p class="mono" style="padding:22px 0">Nothing here yet. Add something from the menu.</p>';
  }
  function addItem(name, price) {
    var found = null;
    for (var i = 0; i < cart.length; i++) if (cart[i].name === name) { found = cart[i]; break; }
    if (found) found.qty++; else cart.push({ name: name, price: price, qty: 1 });
    renderCart(); toast(name + ' added');
  }
  document.addEventListener('click', function (e) {
    var add = e.target.closest('[data-add]');
    if (add) { addItem(add.getAttribute('data-add'), parseInt(add.getAttribute('data-price'), 10) || 0); return; }
    var dec = e.target.closest('[data-dec]');
    if (dec) { var i = +dec.getAttribute('data-dec'); if (--cart[i].qty <= 0) cart.splice(i, 1); renderCart(); return; }
    var inc = e.target.closest('[data-inc]');
    if (inc) { cart[+inc.getAttribute('data-inc')].qty++; renderCart(); }
  });
  function openCart(open) {
    $('cart').setAttribute('data-open', open ? 'true' : 'false');
    $('cart').setAttribute('aria-hidden', open ? 'false' : 'true');
    $('scrim').hidden = !open;
  }
  $('cart-open').addEventListener('click', function () {
    openCart(true);
    if (API.live && cart.length) orderPhoneField();
  });
  $('cart-close').addEventListener('click', function () { openCart(false); });
  $('scrim').addEventListener('click', function () { openCart(false); });
  function waOrder(lines, total, code) {
    var msg = 'Hello Liquid Sky, I would like to order:\n' +
      lines.map(function (l) { return l.qty + ' x ' + l.name + ' — ' + rupees(l.qty * l.price); }).join('\n') +
      '\nTotal: ' + rupees(total) + (code ? '\nOrder code: ' + code : '');
    window.open('https://wa.me/' + PHONE + '?text=' + encodeURIComponent(msg), '_blank', 'noopener');
  }

  /* An order needs a number the kitchen can call back on — the WhatsApp
     flow got that for free from WhatsApp itself, but a recorded order has
     to ask. The field is injected here rather than added to the markup so
     it only ever exists when the cart does. */
  function orderPhoneField() {
    var existing = $('o-phone');
    if (existing) return existing;
    var foot = document.querySelector('.drawer-foot');
    var send = $('cart-send');
    if (!foot || !send) return null;
    var wrap = document.createElement('div');
    wrap.className = 'field order-phone';
    wrap.innerHTML =
      '<label class="mono" for="o-phone">Phone for this order</label>' +
      '<input id="o-phone" type="tel" inputmode="numeric" autocomplete="tel" ' +
      'placeholder="98000 00000" />';
    foot.insertBefore(wrap, send);
    /* If they already typed a number into the reservation form, do not
       make them type it twice. */
    var r = $('r-phone');
    if (r && r.value.trim()) $('o-phone').value = r.value.trim();
    return $('o-phone');
  }

  /* Server ids only exist once the live menu has loaded. Without them we
     cannot place a real order, so the WhatsApp path stays as it was. */
  function serverId(name) {
    for (var i = 0; i < DATA.items.length; i++) {
      if (DATA.items[i][0] === name) return DATA.items[i][5];
    }
    return undefined;
  }

  $('cart-send').addEventListener('click', function () {
    if (!cart.length) { toast('Your order is empty'); return; }
    var btn = $('cart-send');

    var ids = cart.map(function (l) { return { id: serverId(l.name), qty: l.qty }; });
    var haveIds = API.live && ids.every(function (x) { return typeof x.id === 'number'; });
    if (!haveIds) { waOrder(cart, cartTotal()); return; }

    var pf = orderPhoneField();
    var phone = pf ? pf.value.trim() : '';
    if (!/\d{10}/.test(phone.replace(/\D/g, ''))) {
      toast('A number we can call you back on');
      if (pf) pf.focus();
      return;
    }

    btn.disabled = true;
    var label = btn.textContent;
    btn.textContent = 'Sending…';
    /* The server recomputes every price from the database and ignores the
       totals this page carries — a cart is client-side state and a guest
       can edit it in devtools. What comes back is authoritative. */
    apiFetch('/api/orders', { method: 'POST', timeout: 8000,
      body: { phone: phone, items: ids } })
      .then(function (res) {
        toast('Order ' + res.code + ' · ' + rupees(res.total));
        waOrder(cart, res.total, res.code);
      })
      .catch(function (err) {
        if (err && err.status === 409 && err.body && err.body.items) {
          /* Something sold out between loading the page and checking out. */
          var names = err.body.items.map(function (i) { return i.name; });
          toast('Just sold out: ' + names.join(', '));
          names.forEach(function (n) {
            for (var i = cart.length - 1; i >= 0; i--) if (cart[i].name === n) cart.splice(i, 1);
            for (var j = 0; j < DATA.items.length; j++) if (DATA.items[j][0] === n) DATA.items[j][4] = false;
          });
          renderCart(); renderMenu();
        } else {
          waOrder(cart, cartTotal());
        }
      })
      .then(function () { btn.disabled = false; btn.textContent = label; });
  });

  /* --------------------------------------------------------------- CHAT
     Rewritten after testing 20 real diner questions against the first
     version: 11 fell through to the catch-all, and two answered wrongly —
     "do you accept cards" matched the substring "ac" inside "accept" and
     replied about air conditioning.

     Three things fixed here:
       1. Word-boundary matching, so "accept" no longer contains "ac".
       2. Best-score wins instead of first-rule-wins, so a question that
          touches two topics gets the more specific answer.
       3. The bot now actually queries the 287-item menu. It had a full
          price list sitting next to it and answered "how much is chicken
          biryani" with a generic spend range.
     ------------------------------------------------------------------ */
  /* Question words, not dish words. "how old are you" reduced to ["old"],
     which matched Old Monk and got answered as a confident price. */
  var STOP = ['the','a','an','is','are','do','does','you','your','yours','i','we','us','can','get',
    'have','has','of','for','to','in','on','at','me','my','and','it','its','whats','what','when',
    'how','who','why','which','much','many','any','there','with','price','cost','got','tell','about',
    'old','new','guys','please','pls','know','like','want','need','would','could','should','name'];

  function tokens(str) {
    return normalise(str).replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
      .filter(function (w) { return w && STOP.indexOf(w) < 0; });
  }
  function hasWord(text, word) {
    return new RegExp('(^|[^a-z])' + word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^a-z]|$)').test(text);
  }

  /* ---- menu lookup: the bot's most useful trick ---- */
  var MENU_INDEX = DATA.items.map(function (it) {
    return { name: it[0], cat: it[1], price: it[2], veg: it[3], words: tokens(it[0]) };
  });
  var CAT_WORDS = { starter:'starters', tandoor:'tandoor', soup:'soups', main:'mains',
    biriyani:'biryani', chinese:'chinese', coastal:'coastal', bread:'breads', side:'sides',
    dessert:'desserts', mocktail:'mocktails', cocktail:'cocktails', spirit:'spirits', kabab:'tandoor' };

  function priceLine(m) {
    return m.name + (m.price > 0 ? ' — ' + rupees(m.price) : ' — ask us');
  }
  function dishMatch(qt, minScore) {
    var best = [], bestScore = 0, matchedWords = [];
    MENU_INDEX.forEach(function (m) {
      var score = 0, hits = [];
      qt.forEach(function (w) { if (m.words.indexOf(w) > -1) { score++; hits.push(w); } });
      if (score > bestScore) { bestScore = score; best = [m]; matchedWords = hits; }
      else if (score === bestScore && score > 0 && best.length < 4) best.push(m);
    });
    if (bestScore < minScore || !best.length) return null;

    /* One matching word is only trustworthy if it is a distinctive one.
       Short tokens produce nonsense hits — "old" landing on Old Monk — and
       the answer is stated as fact, so the bar has to be higher than
       "something matched". Two or more words can speak for themselves. */
    if (bestScore === 1) {
      var w = matchedWords[0] || '';
      if (w.length < 4) return null;
    }
    if (best.length === 1) {
      var m = best[0];
      return m.name + ' is ' + (m.price > 0 ? rupees(m.price) : 'market price — ask us') +
             ' (' + (LABELS[m.cat] || m.cat) + ', ' + (m.veg ? 'veg' : 'non-veg') + ').';
    }
    return 'We have ' + best.length + ' that match: ' + best.map(priceLine).join(' · ') + '.';
  }

  function menuAnswer(q) {
    var qt = tokens(q);
    if (!qt.length) return null;

    /* Order matters. "mutton biryani" names a dish AND a category; the
       category branch used to win and answer with three other biryanis.
       A confident dish match (2+ words) goes first. */
    var specific = dishMatch(qt, 2);
    if (specific) return specific;

    /* a whole category asked for: "do you have desserts" */
    for (var i = 0; i < qt.length; i++) {
      var cat = CAT_WORDS[qt[i]];
      if (cat) {
        var inCat = MENU_INDEX.filter(function (m) { return m.cat === cat; });
        if (inCat.length) {
          var sample = inCat.slice(0, 3).map(priceLine).join(' · ');
          return 'Yes — ' + inCat.length + ' under ' + (LABELS[cat] || cat) + '. For example: ' +
                 sample + '. The full list is in the menu section above.';
        }
      }
    }
    /* a specific dish, at lower confidence */
    var loose = dishMatch(qt, 1);
    if (loose) return loose;
    return null;
  }

  /* ---- intents, scored ---- */
  var INTENTS = [
    /* Typos included on purpose. "hie" was escalating to the model, which
       costs a round trip and ~4k tokens to say hello. */
    { id:'greet',   k:['hi','hii','hie','hey','heyy','helo','hello','hlo','yo','namaste','hola','evening','morning'],
      a: function () { var s = serviceState();
        return s.open ? 'Hello! We are open right now — kitchen runs until 12:30 AM. Ask me about the menu, a table, or how to find us.'
                      : 'Hello! We are closed at the moment, opening at 11:00 AM. Ask away and I will have it ready for you.'; } },
    { id:'thanks',  k:['thanks','thank','cheers','great','awesome','perfect'],
      a:'Anytime. If you would like a table, the reserve form is on this page — or message us on WhatsApp at 087927 42988.' },
    { id:'hours',   k:['time','timing','timings','hour','hours','open','close','closing','shut','late','midnight'],
      a: function () { var s = serviceState(); var d = new Date();
        if (s.lastCall) return 'We are open, but it is last orders now — the kitchen closes at 12:30 AM.';
        if (s.open) { var mins = (24 * 60 + 30) - (d.getHours() * 60 + d.getMinutes());
          if (mins > 24 * 60) mins -= 24 * 60;
          var hrs = Math.floor(mins / 60);
          return 'Open right now — ' + (hrs >= 1 ? 'about ' + hrs + ' hour' + (hrs > 1 ? 's' : '') + ' left' : 'closing shortly') +
                 '. We run every day until 12:30 AM.'; }
        return 'Closed at the moment. We open at 11:00 AM and serve every day until 12:30 AM.'; } },
    { id:'where',   k:['where','address','location','reach','flyover','direction','directions','find','map','far','near','airport','lost','missed'],
      a:'No. 842/2, Balaji Complex, 2nd floor, Vidya Nagar Cross Road, Yelahanka. Coming from the airport, stay on the service road — do not take the flyover at Vidyanagar Cross. Plus code 5J6G+MH.',
      link:{ t:'Get directions', u:'https://www.google.com/maps/dir/?api=1&destination=13.1616%2C77.6264' } },
    { id:'delivery',k:['deliver','delivery','swiggy','zomato','takeaway','parcel','drive','pickup','collect'],
      a:'Yes — no-contact delivery and drive-through. Order the full menu on Swiggy, or build a cart on this page and send it to us on WhatsApp.',
      link:{ t:'Order on Swiggy', u:SWIGGY } },
    { id:'book',    k:['book','booking','table','reserve','reservation','seat','seats','party','birthday','anniversary','celebration','group','large'],
      a:'Happy to hold a table — including larger groups and birthdays. Use the reserve form on this page and it goes straight to us on WhatsApp.',
      link:{ t:'WhatsApp us', u:'https://wa.me/' + PHONE } },
    { id:'veg',     k:['veg','vegetarian','jain','vegan','pure'],
      a:'Plenty of vegetarian across every section — tick “Veg only” above the menu to filter all 287 items. For Jain preparations, please tell the kitchen when you order and they will do their best.' },
    { id:'spend',   k:['expensive','budget','spend','cheap','afford','bill','average'],
      a:'Around ₹400 to ₹1,400 for two, depending on whether the bar gets involved.' },
    { id:'bar',     k:['bar','drink','drinks','cocktail','beer','alcohol','whisky','wine','liquor','pub','mocktail'],
      a:'Full bar — 10 cocktails, 8 mocktails and a 44-strong spirits list, poured until close.' },
    { id:'parking', k:['park','parking','valet','car','bike'],
      a:'Yes, parking is available on site.' },
    { id:'space',   k:['rooftop','terrace','outdoor','indoor','ambience','ambiance','view','hall','family','kids','children','couple','ac','air','conditioned','conditioning'],
      a:'Both — an air-conditioned hall indoors and the open-air rooftop. It is a family fine dine, so families and children are very welcome, and there is no cover charge.' },
    { id:'pay',     k:['card','cards','upi','cash','payment','pay','gpay','paytm'],
      a:'Cards, UPI and cash are all fine.' },
    { id:'music',   k:['music','dj','live','band','screen','match','sports'],
      a:'The rooftop keeps things relaxed rather than loud. For live screenings or a particular evening, message us on WhatsApp and we will tell you what is on.' },
    { id:'dress',   k:['dress','code','formal','casual','attire'],
      a:'No dress code — come as you are.' },
    { id:'smoking', k:['smoke','smoking','cigarette','hookah','sheesha'],
      a:'There is open-air rooftop seating. For anything specific, please ask the staff on the night.' },
    { id:'recommend',k:['recommend','suggest','best','popular','signature','famous','speciality','specialty','must','try','good'],
      a:'Start with the tandoor — Tandoori Chicken (₹530) or Kalmi Kabab (₹380). From the coastal side, Chicken Sukka (₹329) and Guntur Chicken (₹329). Reviewers keep coming back for the ghee-roast style dishes and the kababs.' },
    { id:'wifi',    k:['wifi','internet','network'],
      a:'Ask the staff on the night and they will get you connected.' }
  ];

  function answer(text) {
    var t = normalise(text).replace(/[^a-z0-9\s]/g, ' ');
    var best = null, bestScore = 0;
    INTENTS.forEach(function (intent) {
      var score = 0;
      intent.k.forEach(function (w) { if (hasWord(t, w)) score += w.length > 4 ? 2 : 1; });
      if (score > bestScore) { bestScore = score; best = intent; }
    });

    /* A dish or category question beats a weak generic match — "how much is
       chicken biryani" used to answer with the average spend. */
    var fromMenu = menuAnswer(text);
    /* A menu hit is a fact out of the data — always trustworthy, always local. */
    if (fromMenu && bestScore <= 2) return { text: fromMenu, score: 99, fact: true };
    if (best) return { text: typeof best.a === 'function' ? best.a() : best.a, link: best.link,
                       score: bestScore, fact: best.id === 'hours' || best.id === 'where' };
    if (fromMenu) return { text: fromMenu, score: 99, fact: true };
    return { text: 'I can help with timings, directions, the menu, delivery, prices or a table. You can also call us on 087927 42988.',
             score: 0, fact: false };
  }

  /* ------------------------------------------------------- GEMINI LAYER
     The API key is NOT here and must never be. This page is static: every
     byte of it is delivered to the visitor, so a key in this file is
     readable via View Source and scrapeable by bots — on the restaurant's
     billing account. The key lives only in the server's environment
     (liquid-sky-rooftop-lounge/server/gemini.ts reads process.env), and
     the browser talks to that server, never to Google.

     Division of labour: the local engine answers facts — prices, hours,
     address — instantly, for free, and without any chance of inventing a
     dish. Gemini handles the open-ended questions the rules miss. That
     ordering matters; the model hallucinating a menu item is precisely the
     bug that took a full pass to clean up earlier.

     Every failure path lands on the local answer, so the AI layer can only
     ever improve this widget, never break it. */
  var CHAT_API = (document.querySelector('meta[name="chat-api"]') || {}).content || '';
  /* Measured latency on this model swings from 2.5s to 81s. 15s catches the
     realistic replies without leaving a guest watching dots for over a
     minute — past that the local answer is genuinely the better product. */
  var REMOTE_TIMEOUT = 15000;
  var history = [];
  var lastSend = 0;

  function remoteAnswer(message) {
    if (!CHAT_API) return Promise.resolve(null);
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, REMOTE_TIMEOUT);
    return fetch(CHAT_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: message.slice(0, 1000), history: history.slice(-6) }),
      signal: ctrl.signal
    })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { return d && typeof d.text === 'string' && d.text.trim() ? d.text : null; })
      .catch(function () { return null; })          // offline, blocked, 429, timeout
      .then(function (v) { clearTimeout(timer); return v; });
  }

  function typingOn() {
    var log = $('chat-log');
    var d = document.createElement('div');
    d.className = 'msg msg-bot is-typing';
    d.id = 'typing';
    d.innerHTML = '<span></span><span></span><span></span>';
    log.appendChild(d); log.scrollTop = log.scrollHeight;
  }
  function typingOff() { var t = $('typing'); if (t) t.remove(); }

  function say(text, who, link) {
    var log = $('chat-log');
    var d = document.createElement('div');
    d.className = 'msg msg-' + who;
    d.textContent = text;
    if (link) {
      var a = document.createElement('a');
      a.href = link.u; a.target = '_blank'; a.rel = 'noopener noreferrer';
      a.className = 'msg-link'; a.textContent = link.t + ' ↗';
      d.appendChild(a);
    }
    log.appendChild(d); log.scrollTop = log.scrollHeight;
  }
  var GENERIC = 'I can help with timings, directions, the menu, delivery, prices or a table.';

  function ask(t) {
    var now = Date.now();
    if (now - lastSend < 800) return;             // client-side throttle
    lastSend = now;

    say(t, 'me');
    history.push({ role: 'user', text: t.slice(0, 1000) });

    var local = answer(t);

    /* Gate on how STRONGLY the rules matched, not merely on whether they
       avoided the catch-all. "we are 6 celebrating an anniversary, what
       should we order" hit the single word "anniversary" (score 2) and
       answered about holding a table — confidently, and beside the point.
       Facts (menu, hours, address) stay local; one weak keyword escalates. */
    var STRONG = 4;
    var confident = local.fact || local.score >= STRONG;

    if (confident || !CHAT_API) {
      setTimeout(function () {
        say(local.text, 'bot', local.link);
        history.push({ role: 'model', text: local.text });
      }, 240);
      return;
    }

    typingOn();
    remoteAnswer(t).then(function (reply) {
      typingOff();
      var text = reply || local.text;
      say(text, 'bot', reply ? null : local.link);
      history.push({ role: 'model', text: text });
    });
  }

  var CHIPS = ['Are you open now?', 'How do I find you?', 'What do you recommend?', 'Do you deliver?', 'Book a table'];
  $('chips').innerHTML = CHIPS.map(function (c) { return '<button class="chip" type="button">' + esc(c) + '</button>'; }).join('');
  $('chips').addEventListener('click', function (e) { var b = e.target.closest('.chip'); if (b) ask(b.textContent); });
  $('chat-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var v = $('chat-in').value.trim(); if (!v) return;
    $('chat-in').value = ''; ask(v);
  });
  function openChat(open) {
    $('chat').hidden = !open; $('chat-open').hidden = open;
    if (open && !$('chat').dataset.greeted) {
      $('chat').dataset.greeted = '1';
      var s = serviceState();
      say(s.open
        ? 'Evening! We are open — the kitchen runs until 12:30 AM. Ask me about a dish, a table, or how to find us.'
        : 'Hello! We are closed right now, opening at 11:00 AM. Ask me anything and I will have it ready for you.', 'bot');
    }
    if (open) $('chat-in').focus();
  }
  $('chat-open').addEventListener('click', function () { openChat(true); });
  $('chat-close').addEventListener('click', function () { openChat(false); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { openCart(false); openChat(false); }
  });

  /* ---------------------------------------------------------- RESERVATION */
  /* ------------------------------------------------------- RESERVATIONS
     Previously this only opened a pre-filled WhatsApp draft. If the guest
     never pressed send — and plenty do not — the booking simply never
     existed: no record, no confirmation, nothing stopping a second table
     at the same hour. It now writes a real row first and gets a code back.

     WhatsApp is still the confirmation channel, because that is how this
     restaurant actually talks to its guests. It just is no longer the
     thing the booking *depends* on. If the API is unreachable we fall
     straight back to the old behaviour, so this is never a downgrade. */
  var rform = $('rform');
  var rbtn = rform ? rform.querySelector('button[type="submit"]') : null;

  function waReserve(f) {
    var msg = 'Hello Liquid Sky, I would like to reserve a table.\n' +
      'Name: ' + f.name + '\nDate: ' + f.date + '\nTime: ' + f.time +
      '\nGuests: ' + f.guests + '\nPhone: ' + f.phone +
      (f.code ? '\nBooking code: ' + f.code : '');
    window.open('https://wa.me/' + PHONE + '?text=' + encodeURIComponent(msg), '_blank', 'noopener');
  }

  function bookedPanel() {
    var el = $('booked');
    if (el) return el;
    el = document.createElement('div');
    el.className = 'booked';
    el.id = 'booked';
    el.hidden = true;
    el.setAttribute('role', 'status');       /* announced without stealing focus */
    if (rform) rform.parentNode.insertBefore(el, rform.nextSibling);
    return el;
  }

  function showBooked(res, f) {
    var el = bookedPanel();
    var when = f.date + ' · ' + f.time;
    el.innerHTML =
      '<span class="booked-lbl mono">Table held</span>' +
      '<strong class="booked-code">' + esc(res.code) + '</strong>' +
      '<p>' + esc(f.name) + ' · ' + esc(when) + ' · ' + esc(f.guests) + '</p>' +
      '<p class="booked-note">Quote that code when you arrive. We will confirm on WhatsApp — ' +
      'tap below if you would like to message us now.</p>' +
      '<button class="btn" type="button" id="booked-wa">Message on WhatsApp</button>';
    el.hidden = false;
    var wa = $('booked-wa');
    if (wa) wa.addEventListener('click', function () {
      waReserve({ name: f.name, date: f.date, time: f.time, guests: f.guests,
                  phone: f.phone, code: res.code });
    });
  }

  if (rform) rform.addEventListener('submit', function (e) {
    e.preventDefault();
    var g = function (id) { return (($(id) || {}).value || '').trim(); };
    var f = { name: g('r-name'), date: g('r-date'), time: g('r-time'),
              guests: g('r-guests'), phone: g('r-phone') };

    /* Checked here as well as on the server so the guest is told what is
       wrong before a round trip, and told it next to the field. */
    if (f.name.length < 2) { toast('Whose name is the table under?'); ($('r-name') || {}).focus && $('r-name').focus(); return; }
    if (!/\d{10}/.test(f.phone.replace(/\D/g, ''))) { toast('A 10-digit phone number, please'); $('r-phone').focus(); return; }
    if (!f.date) { toast('Pick a date'); $('r-date').focus(); return; }

    var iso = slotISO(f.date, f.time);
    var party = parseInt(f.guests, 10) || 2;

    if (!iso || !window.fetch) { waReserve(f); toast('Opening WhatsApp…'); return; }

    if (rbtn) { rbtn.disabled = true; rbtn.textContent = 'Holding your table…'; }
    apiFetch('/api/reservations', {
      method: 'POST', timeout: 8000,
      body: { name: f.name, phone: f.phone, party_size: party, slot_at: iso, note: '' }
    }).then(function (res) {
      showBooked(res, f);
      toast('Table held · ' + res.code);
      if (rbtn) rbtn.textContent = 'Book another table';
    }).catch(function (err) {
      /* A 400 is the guest's input and worth showing. Anything else means
         the server is unreachable or broken, which is not their problem —
         fall back to WhatsApp rather than making them retype it. */
      if (err && err.status === 400 && err.body && err.body.error) {
        toast(err.body.error);
      } else if (err && err.status === 429) {
        toast('Too many requests just now — try again in a minute.');
      } else {
        waReserve(f);
        toast('Opening WhatsApp…');
      }
      if (rbtn) rbtn.textContent = 'Send on WhatsApp';
    }).then(function () {
      if (rbtn) rbtn.disabled = false;
    });
  });
  (function defaultDate() {
    var el = $('r-date'); if (!el) return;
    var iso = function (d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); };
    var today = new Date();
    el.value = iso(today);
    /* The server rejects a slot in the past, but the guest should not be
       able to pick one in the first place — and the picker itself is the
       right place to say so. Ninety days matches the server's window. */
    el.min = iso(today);
    var far = new Date(today.getTime() + 90 * 864e5);
    el.max = iso(far);
  })();

  /* -------------------------------------------------------------- TOAST */
  var tt;
  function toast(msg) {
    var el = $('toast'); el.textContent = msg; el.classList.add('is-on');
    clearTimeout(tt); tt = setTimeout(function () { el.classList.remove('is-on'); }, 1900);
  }


  /* --------------------------------------------------- SCROLL SPLIT
     Progress is written to a CSS custom property and the transforms live
     in CSS, so scrolling never triggers layout — the compositor does the
     work. Coalesced through rAF so a burst of scroll events costs one
     update, and skipped entirely when the section is off screen. */
  (function scrollSplit() {
    var sec = $('split'); if (!sec) return;
    var top = sec.querySelector('.is-top'), bot = sec.querySelector('.is-bot');
    /* Set background-image directly, NOT through a custom property. A url()
       inside a CSS variable resolves against the stylesheet that consumes
       it (assets/app.css), so "photos/x.jpg" became "assets/photos/x.jpg"
       and silently 404'd. An inline background-image resolves against the
       DOCUMENT — and the document is now served at /, not from this
       folder, so the path has to be absolute or it 404s the other way. */
    if (top && bot) {
      var img = 'url("/site/photos/rooftopDusk.jpg")';
      top.style.backgroundImage = img;
      bot.style.backgroundImage = img;
    }
    /* No IntersectionObserver gate here. It was guarding a single
       getBoundingClientRect, and when its callback got throttled the flag
       stuck false and the shutters never opened at all. A cheap read every
       coalesced frame is the better trade. update() early-outs when the
       section is nowhere near the viewport. */
    var queued = false;
    function update() {
      queued = false;
      var r = sec.getBoundingClientRect();
      if (r.bottom < -200 || r.top > window.innerHeight + 200) return;
      var span = r.height - window.innerHeight;
      var p = span > 0 ? (-r.top) / span : 0;
      sec.style.setProperty('--split', Math.max(0, Math.min(1, p)).toFixed(3));
    }
    function schedule() {
      if (queued) return;
      queued = true;
      /* rAF never fires in a hidden tab, which pinned --split at 0. */
      if (document.hidden) setTimeout(update, 16);
      else requestAnimationFrame(update);
    }
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule, { passive: true });
    update();
    setTimeout(update, 400);
  })();


  /* --------------------------------------------------------------- LOADER
     Held until the real work is done — fonts settled and the first sky
     frame drawn — rather than a flat timer that either cuts the page off
     early or wastes a visitor's time. MIN keeps it from flashing; MAX
     guarantees nobody is ever stuck behind it on a bad connection or if a
     promise never settles. */
  (function loader() {
    var el = $('loader'); if (!el) return;
    var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    /* Held a full 5s by request. MAX still sits above it so a stalled
       promise or a dead network can never trap anyone behind the screen. */
    var MIN = reduced ? 0 : 5000, MAX = 7000, start = Date.now(), finished = false;
    document.documentElement.style.setProperty('--load-ms', MIN + 'ms');

    function finish() {
      if (finished) return;
      finished = true;
      var wait = Math.max(0, MIN - (Date.now() - start));
      setTimeout(function () {
        el.classList.add('is-done');
        setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 700);
        observeReveals(); forceRevealVisible();     // reveal whatever is on screen now
      }, wait);
    }

    /* Show the film only once it can actually run. Autoplay is blocked in
       some contexts and the file is several MB — until then the CSS
       kitchen is already on screen, so there is never a blank hold. */
    var vid = $('loader-video');
    if (vid) {
      var showVideo = function () { el.classList.add('has-video'); };
      if (vid.readyState >= 3) showVideo();
      vid.addEventListener('canplay', showVideo, { once: true });
      vid.addEventListener('error', function () { /* keep the CSS scene */ }, { once: true });
      /* Plays at normal speed. The previous clip was a 10s montage that
         had to run at 2x to fit its whole story into a 5s hold; this one
         is a single continuous 5.9s shot of a knife working through the
         prep, so the hold shows it almost end to end and doubling the rate
         would only smear the blade. The loop attribute covers the case
         where a slow connection pushes the hold out to MAX. */
      vid.playbackRate = 1.0;
      /* The autoplay attribute and this explicit play() race each other:
         the first call reliably rejects with AbortError and, with the
         rejection swallowed, the clip sat frozen on its opening frame while
         the progress bar ran underneath — which reads as a broken image
         rather than a loading screen. The second attempt always takes.
         Muted autoplay can also be deferred rather than refused (background
         tab, Low Power Mode, data saver), so keep asking while the loader is
         up, and ask again the moment the tab becomes visible. */
      var tries = 0, retry;
      function tryPlay() {
        if (finished || !vid.paused || tries >= 14) { clearInterval(retry); return; }
        tries++;
        var p = vid.play();
        if (p && p.catch) p.catch(function () { /* deferred; the retry covers it */ });
      }
      tryPlay();
      retry = setInterval(tryPlay, 200);
      document.addEventListener('visibilitychange', tryPlay);
    }

    var fonts = (document.fonts && document.fonts.ready) || Promise.resolve();
    Promise.all([fonts]).then(function () {
      /* wait for one real sky frame so the page never appears mid-paint */
      var tries = 0;
      (function waitForSky() {
        if (finished) return;
        if ((window.__sky && window.__sky.frames > 0) || tries > 40) return finish();
        tries++; setTimeout(waitForSky, 60);
      })();
    });
    setTimeout(finish, MAX);                        // hard ceiling
    if (reduced) finish();
  })();

  renderCats(); renderMenu(); renderCart();

  /* --------------------------------------------------------- LIVE MENU
     Runs after the baked-in menu is already on screen, so the page is
     never waiting on a network call to show 287 dishes. If the API
     answers, prices refresh and anything the kitchen has 86'd tonight is
     marked sold out in place. If it does not, nothing happens at all —
     which is exactly what should happen on a static host. */
  (function liveMenu() {
    if (!window.fetch) return;
    /* The backend behind this page is the ordering system: the same
       database the pass, the bar screen and /admin read. Its /api/menu
       returns sections with their items nested, not a flat list, so the
       287 dishes baked into this page are matched by name — verified
       unique across the whole card — and refreshed in place.

       'no-cache' means revalidate, not "never cache". On the default
       policy the browser can answer from its own copy, and a dish the
       kitchen has just switched off would go on being offered. */
    apiFetch('/api/menu', { timeout: 6000, cache: 'no-cache' }).then(function (m) {
      if (!m || !m.categories || !m.categories.length) return;
      var byName = {};
      for (var c = 0; c < m.categories.length; c++) {
        var list = m.categories[c].items || [];
        for (var k = 0; k < list.length; k++) byName[list[k].name.toLowerCase()] = list[k];
      }
      /* /api/menu returns only what the kitchen currently has on. A dish
         switched off does not come back marked unavailable — it is simply
         absent. So "missing from the payload" IS the off signal, and an
         overlay that only updated the rows it found left a sold-out drink
         looking orderable. */
      var matched = 0;
      for (var j = 0; j < DATA.items.length; j++) {
        if (byName[String(DATA.items[j][0]).toLowerCase()]) matched++;
      }
      /* Guard against pointing this page at a different restaurant's
         menu: if barely anything lines up, change nothing at all rather
         than greying out the entire card. */
      if (matched < DATA.items.length * 0.6) return;

      var repriced = 0, off = 0;
      for (var k2 = 0; k2 < DATA.items.length; k2++) {
        var it = DATA.items[k2];
        var row = byName[String(it[0]).toLowerCase()];
        if (!row) { it[4] = false; off++; continue; }
        if (typeof row.price === 'number' && row.price !== it[2]) { it[2] = row.price; repriced++; }
        it[4] = true;
        it[5] = row.id;
      }
      API.live = true;
      renderMenu();
      if (off) toast(off + (off === 1 ? ' dish is' : ' dishes are') + ' off tonight');
    }).catch(function () { /* server down — the baked menu still stands */ });
  })();
})();
