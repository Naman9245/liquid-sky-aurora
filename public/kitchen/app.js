/* Liquid Sky — kitchen display. Never lose an order. */
(function () {
  'use strict';

  const params = new URLSearchParams(location.search);
  const STATION = (params.get('station') || '').toUpperCase() || null;

  const state = {
    orders: new Map(),   // id -> order
    lastSeq: 0,
    fresh: new Set(),
    lastAction: 0,
    soundOn: false,
    socket: null,
  };

  const $ = (id) => document.getElementById(id);
  const els = {
    board: $('board'), empty: $('empty'), conn: $('conn'), clock: $('clock'),
    activeCount: $('activeCount'), alert: $('alert'), stationName: $('stationName'),
    soundBtn: $('soundBtn'), soundIcon: $('soundIcon'), soundLabel: $('soundLabel'),
    whoami: $('whoami'), signout: $('signout'), stationNav: $('stationNav'),
  };


  // A session that expired mid-shift should land on the keypad, not a dead screen.
  function toLogin() {
    location.href = '/login?next=' + encodeURIComponent(location.pathname + location.search);
  }

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const STATIONS = ['TANDOOR', 'CURRY', 'BIRYANI', 'CHINESE', 'BAR', 'DESSERT', 'SOUTH_INDIAN', 'BEVERAGE'];

  if (STATION) els.stationName.textContent = STATION.replace(/_/g, ' ') + ' station';

  els.stationNav.innerHTML = [
    `<a href="/kitchen/" class="${STATION ? '' : 'on'}">EXPO</a>`,
    ...STATIONS.map((s) =>
      `<a href="/kitchen/?station=${s}" class="${STATION === s ? 'on' : ''}">${s.replace(/_/g, ' ')}</a>`),
  ].join('');

  /* ------------------------------------------------------------- sound */

  // Browsers block audio until the user interacts, so this is an explicit toggle
  // rather than something that silently fails on the first order of the day.
  let audioCtx = null;
  function beep() {
    if (!state.soundOn) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      [0, 0.18].forEach((offset) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.value = 880;
        gain.gain.setValueAtTime(0.0001, audioCtx.currentTime + offset);
        gain.gain.exponentialRampToValueAtTime(0.35, audioCtx.currentTime + offset + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + offset + 0.15);
        osc.connect(gain).connect(audioCtx.destination);
        osc.start(audioCtx.currentTime + offset);
        osc.stop(audioCtx.currentTime + offset + 0.16);
      });
    } catch { /* no audio on this device — the visual flash still fires */ }
  }

  els.soundBtn.addEventListener('click', () => {
    state.soundOn = !state.soundOn;
    els.soundBtn.setAttribute('aria-pressed', String(state.soundOn));
    els.soundIcon.textContent = state.soundOn ? '🔔' : '🔕';
    els.soundLabel.textContent = state.soundOn ? 'Sound on' : 'Sound off';
    try { localStorage.setItem('hh:kitchen:sound', state.soundOn ? '1' : '0'); } catch {}
    if (state.soundOn) beep();
  });

  try {
    if (localStorage.getItem('hh:kitchen:sound') === '1') els.soundBtn.click();
  } catch {}

  /* -------------------------------------------------------------- render */

  const mine = (o) => (STATION ? o.items.filter((i) => i.station === STATION) : o.items);

  /**
   * A station bumps its own ticket: once every item it is responsible for is
   * plated, the card leaves that screen. The expo keeps the order until the
   * slowest station has finished and someone carries it out.
   */
  function relevant(order) {
    if (!['PLACED', 'PREPARING', 'READY'].includes(order.status)) return false;
    if (!STATION) return true;
    const items = mine(order);
    return items.length > 0 && items.some((i) => i.item_status !== 'READY' && i.item_status !== 'SERVED');
  }

  const STATION_LABEL = (s) => s.replace(/_/g, ' ');

  /** Which stations still owe this order something — the expo's whole job. */
  function stationProgress(order) {
    const byStation = new Map();
    for (const i of order.items) {
      if (!byStation.has(i.station)) byStation.set(i.station, []);
      byStation.get(i.station).push(i);
    }
    return [...byStation.entries()].map(([station, items]) => ({
      station,
      done: items.every((i) => i.item_status === 'READY' || i.item_status === 'SERVED'),
      count: items.length,
    }));
  }

  function urgency(order) {
    const mins = (Date.now() - order.placed_at) / 60000;
    const eta = order.eta_minutes || 15;
    if (mins > eta + 5) return 'late';
    if (mins > eta) return 'warn';
    return 'ok';
  }

  function elapsed(order) {
    const secs = Math.max(0, Math.floor((Date.now() - order.placed_at) / 1000));
    const m = Math.floor(secs / 60);
    return `${m}:${String(secs % 60).padStart(2, '0')}`;
  }

  function render() {
    const list = [...state.orders.values()]
      .filter(relevant)
      .sort((a, b) => a.placed_at - b.placed_at); // oldest first — that's the one at risk

    els.activeCount.textContent = list.length;
    els.empty.hidden = list.length > 0;
    els.board.innerHTML = list.map(orderHtml).join('');
  }

  function orderHtml(o) {
    const items = mine(o);
    const u = urgency(o);
    const progress = STATION ? [] : stationProgress(o);
    // "Still on X" is only information once at least one station has finished.
    const anyDone = progress.some((p) => p.done);
    const waitingOn = anyDone ? progress.filter((p) => !p.done) : [];

    return `<article class="order ${state.fresh.has(o.id) ? 'fresh' : ''}" data-urgency="${u}" data-order="${o.id}">
      <div class="o-head">
        <div>
          <div class="o-seat">${esc(o.service_point.label)}</div>
          <span class="o-sub">#${o.id} · ${esc(o.order_type.replace(/_/g, ' '))}</span>
        </div>
        <div class="o-time">
          <div class="o-elapsed" data-urgency="${u}" data-placed="${o.placed_at}">${elapsed(o)}</div>
          <span class="o-eta">target ${o.eta_minutes} min</span>
          <a class="printlink" target="_blank" rel="noopener"
             href="/api/print/kot/${o.id}?auto=1${STATION ? '&station=' + STATION : ''}">Print ticket</a>
        </div>
      </div>

      ${progress.length > 1 ? `<div class="progress">
        ${progress.map((p) => `<span class="stchip ${p.done ? 'done' : 'out'}">
          ${p.done ? '✓' : '•'} ${esc(STATION_LABEL(p.station))}</span>`).join('')}
      </div>` : ''}

      <div class="o-items">
        ${items.map((i) => `<div class="kitem ${i.item_status === 'READY' || i.item_status === 'SERVED' ? 'plated' : ''}">
          <span class="qty">${i.quantity}×</span>
          <div class="kitem-main">
            <div class="kname">${esc(i.name)}</div>
            <div class="kmeta">
              <i class="kdot ${dietClass(i)}" title="${esc(i.diet_type)}"></i>
              <span class="station">${esc(STATION_LABEL(i.station))}</span>
            </div>
            ${i.special_notes ? `<div class="knote">${esc(i.special_notes)}</div>` : ''}
          </div>
          ${STATION ? itemActionsHtml(o, i) : ''}
        </div>`).join('')}
      </div>

      ${o.notes ? `<div class="o-note">Table note: ${esc(o.notes)}</div>` : ''}

      ${STATION ? '' : `<div class="o-actions">${actionsHtml(o, waitingOn)}</div>`}
    </article>`;
  }

  /** Station screens set one item at a time; the order's status follows. */
  function itemActionsHtml(order, item) {
    const next = item.item_status === 'QUEUED' ? 'PREPARING' : 'READY';
    const label = item.item_status === 'QUEUED' ? 'START' : 'DONE';
    const cls = item.item_status === 'QUEUED' ? 'start' : 'ready';
    if (item.item_status === 'READY' || item.item_status === 'SERVED') {
      return '<span class="itemdone">✓</span>';
    }
    return `<button class="act item ${cls}" type="button"
      data-order="${order.id}" data-item="${item.id}" data-next="${next}">${label}</button>`;
  }

  function dietClass(item) {
    return item.diet_type === 'VEG' ? 'veg' : item.diet_type === 'EGG' ? 'egg' : 'non';
  }

  function actionsHtml(o, waitingOn = []) {
    if (o.status === 'READY') {
      return `<button class="act serve" data-id="${o.id}" data-next="SERVED" type="button">SERVED</button>
              <button class="act cancel" data-id="${o.id}" data-next="PREPARING" type="button">Back</button>`;
    }
    if (o.status === 'PLACED') {
      return `<button class="act start" data-id="${o.id}" data-next="PREPARING" type="button">START</button>
              <button class="act cancel" data-id="${o.id}" data-next="CANCELLED" type="button">Void</button>`;
    }
    // Still cooking. The station chips say who is holding it up; the button
    // stays live so the expo can finish an order even with no station tablets.
    const hint = waitingOn.length
      ? `<span class="waiting">still on: ${waitingOn.map((p) => esc(STATION_LABEL(p.station))).join(', ')}</span>`
      : '';
    return `${hint}<button class="act ready" data-id="${o.id}" data-next="READY" type="button">READY</button>
            <button class="act cancel" data-id="${o.id}" data-next="CANCELLED" type="button">Void</button>`;
  }

  // Ticking the clocks in place avoids re-rendering (and losing) a card mid-tap.
  function tickClocks() {
    els.clock.textContent = new Date().toLocaleTimeString('en-IN',
      { hour: '2-digit', minute: '2-digit', hour12: false });

    document.querySelectorAll('.o-elapsed').forEach((node) => {
      const card = node.closest('.order');
      const real = state.orders.get(Number(card.dataset.order));
      if (!real) return;
      node.textContent = elapsed(real);
      const u = urgency(real);
      node.dataset.urgency = u;
      card.dataset.urgency = u;
    });
  }

  /* -------------------------------------------------------------- socket */

  function applySnapshot(snapshot) {
    if (!snapshot) return;
    const hadCursor = state.lastSeq > 0;
    state.orders.clear();
    for (const o of snapshot.active_orders || []) state.orders.set(o.id, o);
    if (snapshot.last_seq) state.lastSeq = snapshot.last_seq;
    if (snapshot.staff) {
      els.whoami.textContent = snapshot.staff.name;
      state.staff = snapshot.staff;
    }

    // Only meaningful if this screen already had a cursor. On a cold load the
    // replay is just the whole day, and claiming it was "missed" is a lie.
    const missed = hadCursor ? (snapshot.events || []).filter((e) => e.type === 'new_order') : [];
    if (missed.length) {
      missed.forEach((e) => state.fresh.add(e.payload.order.id));
      flash(`${missed.length} order${missed.length > 1 ? 's' : ''} arrived while this screen was offline`);
      beep();
      setTimeout(() => { state.fresh.clear(); render(); }, 6000);
    }
    render();
  }

  function flash(message) {
    els.alert.textContent = message;
    els.alert.hidden = false;
    setTimeout(() => { els.alert.hidden = true; }, 9000);
  }

  function connect() {
    const socket = io({ transports: ['websocket', 'polling'] });
    state.socket = socket;

    socket.on('connect', () => {
      els.conn.dataset.state = 'on';
      els.conn.textContent = 'Live';
      socket.emit(EVENTS.JOIN_KITCHEN, { station: STATION, last_seq: state.lastSeq }, (snap) => {
        if (snap && snap.login_required) return toLogin();
        applySnapshot(snap);
      });
    });

    socket.on('disconnect', () => {
      els.conn.dataset.state = 'off';
      els.conn.textContent = 'Offline';
    });

    socket.on(EVENTS.NEW_ORDER, ({ order, seq }) => {
      if (seq) state.lastSeq = Math.max(state.lastSeq, seq);
      state.orders.set(order.id, order);
      if (relevant(order)) {
        state.fresh.add(order.id);
        beep();
        setTimeout(() => { state.fresh.delete(order.id); render(); }, 6000);
      }
      render();
    });

    socket.on(EVENTS.ORDER_STATUS_CHANGED, ({ order, seq }) => {
      if (seq) state.lastSeq = Math.max(state.lastSeq, seq);
      if (['SERVED', 'CANCELLED'].includes(order.status)) state.orders.delete(order.id);
      else state.orders.set(order.id, order);
      render();
    });
  }

  /* --------------------------------------------------------- belt & braces */

  // Even with replay, poll the truth every 15s. A kitchen screen showing stale
  // orders is worse than one that costs a few extra requests.
  async function poll() {
    try {
      const res = await fetch('/api/orders/active');
      if (res.status === 401 || res.status === 403) return toLogin();
      if (!res.ok) return;
      const { orders, last_seq } = await res.json();
      const known = new Set(orders.map((o) => o.id));
      for (const id of [...state.orders.keys()]) if (!known.has(id)) state.orders.delete(id);
      for (const o of orders) state.orders.set(o.id, o);
      state.lastSeq = Math.max(state.lastSeq, last_seq || 0);
      render();
    } catch { /* offline — the socket will catch up */ }
  }

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.act');
    if (!btn) return;

    // Marking the last item of a card bumps it, and everything below reflows
    // under the cook's hand. Swallow a second tap that lands in that window,
    // so it cannot hit a button belonging to a different table.
    const now = Date.now();
    if (now - state.lastAction < 400) return;
    state.lastAction = now;

    const done = (res) => {
      btn.disabled = false;
      if (res && res.login_required) return toLogin();
      if (res && !res.ok) flash(res.error || 'That did not go through — try again');
    };

    btn.disabled = true;

    if (btn.dataset.item) {
      state.socket.emit(EVENTS.UPDATE_ITEM_STATUS, {
        order_id: Number(btn.dataset.order),
        order_item_id: Number(btn.dataset.item),
        status: btn.dataset.next,
      }, done);
      return;
    }

    const next = btn.dataset.next;
    if (next === 'CANCELLED' && !window.confirm('Void this order?')) { btn.disabled = false; return; }
    state.socket.emit(EVENTS.UPDATE_ORDER_STATUS,
      { order_id: Number(btn.dataset.id), status: next }, done);
  });

  els.signout.addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    location.href = '/login';
  });

  connect();
  setInterval(tickClocks, 1000);
  setInterval(poll, 15000);
})();
