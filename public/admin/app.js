/* Liquid Sky — owner dashboard. */
(function () {
  'use strict';

  const state = {
    categories: [], stations: [], dietTypes: [],
    points: [], kinds: [], baseUrl: '',
    orders: [], stats: null, socket: null,
  };

  const $ = (id) => document.getElementById(id);

  // A session that expired mid-shift should land on the keypad, not a dead screen.
  function toLogin() {
    location.href = '/login?next=' + encodeURIComponent(location.pathname + location.search);
  }

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const rupees = (n) => '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 });
  const clock = (ms) => new Date(ms).toLocaleTimeString('en-IN',
    { hour: '2-digit', minute: '2-digit', hour12: true });

  function toast(message) {
    const b = $('banner');
    b.textContent = message; b.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { b.hidden = true; }, 3200);
  }

  async function api(path, options) {
    const res = await fetch(path, {
      headers: { 'Content-Type': 'application/json' }, ...options,
    });
    const body = await res.json().catch(() => ({}));
    if (res.status === 401 || res.status === 403) { toLogin(); throw new Error(body.error || 'Please sign in'); }
    if (!res.ok) throw new Error(body.error || 'Request failed');
    return body;
  }

  /* --------------------------------------------------------------- tabs */

  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((t) => t.classList.remove('is-on'));
      tab.classList.add('is-on');
      ['orders', 'menu', 'tables', 'insights', 'staff'].forEach((v) => {
        $('view-' + v).hidden = v !== tab.dataset.view;
      });
      if (tab.dataset.view === 'tables') loadPoints();
      if (tab.dataset.view === 'menu') loadMenu();
      if (tab.dataset.view === 'staff') loadStaff();
      if (tab.dataset.view === 'insights') loadInsights();
    });
  });

  /* -------------------------------------------------------------- today */

  async function loadToday() {
    try {
      const { orders, stats } = await api('/api/orders/today');
      state.orders = orders; state.stats = stats;
      renderStats(); renderLive(); renderTodayTable();
    } catch { /* the socket will bring us back up to date */ }
  }

  function renderStats() {
    const s = state.stats;
    if (!s) return;
    const top = s.top_items.length
      ? s.top_items.slice(0, 3).map((t) => `${esc(t.name)} (${t.qty})`).join(', ')
      : 'Nothing sold yet today';
    $('stats').innerHTML = `
      <div class="stat"><span class="l">Orders today</span><b class="n">${s.order_count}</b>
        ${s.cancelled_count ? `<span class="x">${s.cancelled_count} voided</span>` : ''}</div>
      <div class="stat"><span class="l">Items sold</span><b class="n">${s.items_sold}</b></div>
      <div class="stat"><span class="l">Revenue</span><b class="n">${rupees(s.revenue)}</b>
        <span class="x">Pay at counter — not yet reconciled</span></div>
      <div class="stat"><span class="l">On the pass</span><b class="n">${s.active_count}</b></div>
      <div class="stat"><span class="l">Selling best</span><span class="x" style="margin-top:8px">${top}</span></div>`;
  }

  function renderLive() {
    const live = state.orders.filter((o) => ['PLACED', 'PREPARING', 'READY'].includes(o.status));
    $('liveOrders').innerHTML = live.length
      ? live.map((o) => `<div class="ocard">
          <div class="ocard-top">
            <span class="ocard-seat">${esc(o.service_point.label)}</span>
            <span class="pill ${o.status}">${o.status}</span>
          </div>
          <div class="ocard-items">${o.items.map((i) => `${i.quantity}× ${esc(i.name)}`).join('<br>')}</div>
          <div class="ocard-foot"><span>#${o.id} · ${clock(o.placed_at)}</span>
            <span><a class="mini" target="_blank" rel="noopener"
              href="/api/print/bill/${o.id}?auto=1">Bill</a>
            <strong class="num" style="margin-left:8px">${rupees(o.total)}</strong></span></div>
        </div>`).join('')
      : '<p class="empty">Nothing on the pass right now.</p>';
  }

  function renderTodayTable() {
    const tbody = document.querySelector('#todayTable tbody');
    tbody.innerHTML = state.orders.length
      ? state.orders.map((o) => `<tr>
          <td class="num">${o.id}</td>
          <td>${esc(o.service_point.label)}<br><span class="linkcell">${esc(o.order_type.replace(/_/g, ' '))}</span></td>
          <td>${o.items.map((i) => `${i.quantity}× ${esc(i.name)}`).join(', ')}</td>
          <td class="num">${rupees(o.total)}</td>
          <td><span class="pill ${o.status}">${o.status}</span></td>
          <td class="num">${clock(o.placed_at)}</td>
          <td><a class="mini" target="_blank" rel="noopener" href="/api/print/bill/${o.id}?auto=1">Bill</a></td>
        </tr>`).join('')
      : '<tr><td colspan="7" class="empty">No orders today yet.</td></tr>';
  }

  /* --------------------------------------------------------------- menu */

  async function loadMenu() {
    const { categories, stations, diet_types } = await api('/api/menu/all');
    state.categories = categories; state.stations = stations; state.dietTypes = diet_types;
    renderMenuAdmin();
  }

  function renderMenuAdmin() {
    $('menuAdmin').innerHTML = state.categories.map((c) => `
      <section class="mcat">
        <h3 class="mcat-name">${esc(c.name)}</h3>
        ${c.items.map((i) => {
          const d = i.diet_type === 'VEG' ? 'veg' : i.diet_type === 'EGG' ? 'egg' : 'non';
          return `<div class="mrow ${i.is_available ? '' : 'off'}">
            <label class="toggle" title="Available right now">
              <input type="checkbox" data-avail="${i.id}" ${i.is_available ? 'checked' : ''}>
              <span></span>
            </label>
            <div class="mrow-main">
              <div class="mrow-name"><i class="mdot ${d}"></i>${esc(i.name)}
                ${i.is_signature ? '<span class="pill READY">SIGNATURE</span>' : ''}</div>
              <div class="mrow-meta">${esc(i.station.replace(/_/g, ' '))} · ${i.prep_minutes} min
                ${i.spice_level ? ' · spice ' + i.spice_level + '/3' : ''}
                ${i.windows && i.windows.length
                  ? ' · <span class="win">' + esc(i.windows[0].start_time) + '–' + esc(i.windows[0].end_time) + '</span>'
                  : ''}</div>
            </div>
            <span class="mrow-price">${rupees(i.price)}</span>
            <button class="mini" data-edit="${i.id}" type="button">Edit</button>
          </div>`;
        }).join('')}
      </section>`).join('');
  }

  /* ------------------------------------------------------------- tables */

  async function loadPoints() {
    const { service_points, kinds, base_url } = await api('/api/admin/service-points');
    state.points = service_points; state.kinds = kinds; state.baseUrl = base_url;

    const warn = $('baseWarn');
    if (/localhost|127\.0\.0\.1/.test(base_url)) {
      warn.innerHTML = `<strong>These QR codes point at ${esc(base_url)}.</strong>
        A customer's phone cannot reach that. Set <code>PUBLIC_BASE_URL</code> in
        <code>.env</code> to the restaurant's LAN address or domain before printing anything.`;
      warn.hidden = false;
    } else { warn.hidden = true; }

    document.querySelector('#pointsTable tbody').innerHTML = state.points.map((p) => `<tr>
      <td><strong>${esc(p.label)}</strong></td>
      <td>${esc(p.kind.replace(/_/g, ' '))}</td>
      <td>${esc(p.zone || '—')}</td>
      <td class="linkcell">${esc(p.url || (state.baseUrl + p.path))}</td>
      <td style="white-space:nowrap">
        <a class="mini" href="/api/admin/service-points/${p.id}/qr.png">QR</a>
        <button class="mini" data-rotate="${p.id}" type="button" title="Issue a new code and kill the old one">New code</button>
      </td>
    </tr>`).join('');
  }

  /* -------------------------------------------------------------- modal */

  function openModal(item) {
    $('modalTitle').textContent = item ? 'Edit dish' : 'Add a dish';
    $('f_id').value = item ? item.id : '';
    $('f_name').value = item ? item.name : '';
    $('f_description').value = item ? (item.description || '') : '';
    $('f_price').value = item ? item.price : '';
    $('f_prep').value = item ? item.prep_minutes : 15;
    $('f_spice').value = item ? item.spice_level : 0;
    $('f_diet').value = item ? item.diet_type : 'VEG';
    const win = item && item.windows && item.windows.length ? item.windows[0] : null;
    $('f_allday').checked = !win;
    $('windowRow').hidden = !win;
    $('f_from').value = win ? win.start_time : '06:30';
    $('f_to').value = win ? win.end_time : '11:30';
    $('f_signature').checked = item ? item.is_signature : false;
    $('f_available').checked = item ? item.is_available : true;

    $('f_category').innerHTML = state.categories
      .map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
    $('f_station').innerHTML = state.stations
      .map((s) => `<option value="${s}">${esc(s.replace(/_/g, ' '))}</option>`).join('');
    if (item) { $('f_category').value = item.category_id; $('f_station').value = item.station; }

    $('deleteItem').hidden = !item;
    $('formError').hidden = true;
    $('modal').hidden = false; $('scrim').hidden = false;
    $('f_name').focus();
  }

  function closeModal() { $('modal').hidden = true; $('scrim').hidden = true; }

  async function saveItem() {
    const id = $('f_id').value;
    const payload = {
      name: $('f_name').value,
      description: $('f_description').value,
      price: Number($('f_price').value),
      prep_minutes: Number($('f_prep').value),
      spice_level: Number($('f_spice').value),
      diet_type: $('f_diet').value,
      station: $('f_station').value,
      category_id: Number($('f_category').value),
      is_signature: $('f_signature').checked,
      is_available: $('f_available').checked,
    };
    const windows = $('f_allday').checked
      ? []
      : [{ start_time: $('f_from').value, end_time: $('f_to').value, day_of_week: null }];

    try {
      const saved = id
        ? await api(`/api/admin/menu-items/${id}`, { method: 'PUT', body: JSON.stringify(payload) })
        : await api('/api/admin/menu-items', { method: 'POST', body: JSON.stringify(payload) });
      await api(`/api/admin/menu-items/${saved.item.id}/windows`, {
        method: 'PUT', body: JSON.stringify({ windows }),
      });
      closeModal(); await loadMenu();
      toast(id ? 'Dish updated' : 'Dish added');
    } catch (err) {
      $('formError').textContent = err.message; $('formError').hidden = false;
    }
  }

  /* ------------------------------------------------------------- events */

  document.addEventListener('click', async (e) => {
    const edit = e.target.closest('[data-edit]');
    if (edit) {
      const id = Number(edit.dataset.edit);
      const item = state.categories.flatMap((c) => c.items).find((i) => i.id === id);
      return openModal(item);
    }
    const pinBtn = e.target.closest('[data-pin]');
    if (pinBtn) {
      const pin = window.prompt('New PIN — 4 to 8 digits.\nAny session they have open will be signed out.');
      if (!pin) return;
      try {
        await api(`/api/auth/staff/${pinBtn.dataset.pin}/pin`, {
          method: 'POST', body: JSON.stringify({ pin: pin.trim() }),
        });
        toast('PIN changed');
      } catch (err) { toast(err.message); }
      return;
    }
    const toggleStaff = e.target.closest('[data-toggle-staff]');
    if (toggleStaff) {
      const makeActive = toggleStaff.dataset.active !== '1';
      try {
        await api(`/api/auth/staff/${toggleStaff.dataset.toggleStaff}/active`, {
          method: 'POST', body: JSON.stringify({ is_active: makeActive }),
        });
        await loadStaff();
        toast(makeActive ? 'Enabled' : 'Disabled — their PIN no longer works');
      } catch (err) { toast(err.message); }
      return;
    }
    const rotate = e.target.closest('[data-rotate]');
    if (rotate) {
      if (!window.confirm('Issue a new code? The printed tent card for this table will stop working.')) return;
      await api(`/api/admin/service-points/${rotate.dataset.rotate}/rotate`, { method: 'POST' });
      await loadPoints();
      return toast('New code issued — reprint that tent card');
    }
  });

  document.addEventListener('change', async (e) => {
    const avail = e.target.closest('[data-avail]');
    if (!avail) return;
    try {
      await api(`/api/admin/menu-items/${avail.dataset.avail}/availability`, {
        method: 'POST', body: JSON.stringify({ is_available: avail.checked }),
      });
      avail.closest('.mrow').classList.toggle('off', !avail.checked);
      toast(avail.checked ? 'Back on the menu' : 'Marked sold out — it disappears from every phone now');
    } catch (err) { toast(err.message); avail.checked = !avail.checked; }
  });

  $('newStaff').addEventListener('click', async () => {
    const name = window.prompt('Their name — this appears on the receipt when they serve a table');
    if (!name) return;
    const role = window.prompt('Role: MANAGER or KITCHEN', 'KITCHEN');
    if (!role) return;
    const pin = window.prompt('PIN — 4 to 8 digits');
    if (!pin) return;
    try {
      await api('/api/auth/staff', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), role: role.toUpperCase().trim(), pin: pin.trim() }),
      });
      await loadStaff(); toast('Added');
    } catch (err) { toast(err.message); }
  });

  $('signout').addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    location.href = '/login';
  });

  $('f_allday').addEventListener('change', () => {
    $('windowRow').hidden = $('f_allday').checked;
  });

  $('newItem').addEventListener('click', () => openModal(null));
  $('saveItem').addEventListener('click', saveItem);
  $('closeModal').addEventListener('click', closeModal);
  $('scrim').addEventListener('click', closeModal);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
  $('itemForm').addEventListener('submit', (e) => { e.preventDefault(); saveItem(); });

  $('deleteItem').addEventListener('click', async () => {
    const id = $('f_id').value;
    if (!id || !window.confirm('Delete this dish? Past orders keep their own record of it.')) return;
    try {
      await api(`/api/admin/menu-items/${id}`, { method: 'DELETE' });
      closeModal(); await loadMenu(); toast('Dish deleted');
    } catch (err) { $('formError').textContent = err.message; $('formError').hidden = false; }
  });

  $('newPoint').addEventListener('click', async () => {
    const label = window.prompt('What should this be called? (e.g. Table 13, Room 204)');
    if (!label) return;
    const kind = window.prompt(`Kind — one of: ${state.kinds.join(', ')}`, 'TABLE');
    if (!kind) return;
    try {
      await api('/api/admin/service-points', {
        method: 'POST', body: JSON.stringify({ label, kind: kind.toUpperCase().trim() }),
      });
      await loadPoints(); toast('Added — print its tent card from the button above');
    } catch (err) { toast(err.message); }
  });

  /* -------------------------------------------------------------- staff */

  function renderWhoami(staff) {
    $('whoami').textContent = `${staff.name} · ${staff.role === 'MANAGER' ? 'Manager' : 'Kitchen'}`;
  }

  async function loadStaff() {
    const { staff, roles } = await api('/api/auth/staff');
    state.staff = staff; state.roles = roles;
    document.querySelector('#staffTable tbody').innerHTML = staff.map((s) => `<tr>
      <td><strong>${esc(s.name)}</strong></td>
      <td>${s.role === 'MANAGER' ? 'Manager' : 'Kitchen'}</td>
      <td>${s.is_active
        ? '<span class="pill READY">ACTIVE</span>'
        : '<span class="pill CANCELLED">DISABLED</span>'}</td>
      <td style="white-space:nowrap">
        <button class="mini" data-pin="${s.id}" type="button">Change PIN</button>
        <button class="mini" data-toggle-staff="${s.id}" data-active="${s.is_active ? 1 : 0}" type="button">
          ${s.is_active ? 'Disable' : 'Enable'}</button>
      </td>
    </tr>`).join('');
  }


  /* ----------------------------------------------------------- insights */

  const compact = (n) => (n >= 100000 ? '₹' + (n / 100000).toFixed(1) + 'L'
    : n >= 1000 ? '₹' + Math.round(n / 1000) + 'K' : '₹' + Math.round(n));
  const hourLabel = (h) => {
    const am = h < 12; const v = h % 12 === 0 ? 12 : h % 12;
    return v + (am ? 'am' : 'pm');
  };

  /** One shared tooltip, positioned from the mark under the pointer. */
  function vizTip(html, evt) {
    let tip = $('vizTip');
    if (!html) { if (tip) tip.remove(); return; }
    if (!tip) {
      tip = document.createElement('div');
      tip.id = 'vizTip';
      document.body.appendChild(tip);
    }
    tip.innerHTML = html;
    const r = tip.getBoundingClientRect();
    tip.style.left = Math.min(window.innerWidth - r.width - 10,
      Math.max(10, evt.clientX - r.width / 2)) + 'px';
    tip.style.top = Math.max(10, evt.clientY - r.height - 14) + 'px';
  }

  /**
   * Columns, one series. Height carries magnitude; the accent is spent only on
   * the peak, because "when are we busiest" is the whole question.
   */
  function columnChart(rows, { value, label, tip, emphasise = () => false }) {
    const W = 860, H = 230, padL = 46, padR = 12, padT = 18, padB = 30;
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const band = plotW / rows.length;
    const barW = Math.min(24, band - 6);
    // The top of the scale snaps to a number a person reads without decoding —
    // 40,000, never 31,704 — while staying close enough to the data that the
    // tallest bar still fills the plot. The midpoint gets a gridline but no
    // label, because half of a clean number often isn't one.
    const raw = Math.max(1, ...rows.map(value));
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const max = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((m) => m * mag >= raw) * mag;
    const ticks = [{ v: 0, label: true }, { v: max / 2, label: false }, { v: max, label: true }];

    const y = (v) => padT + plotH - (v / max) * plotH;

    const grid = ticks.map((t) => `
      <line class="gridline" x1="${padL}" y1="${y(t.v)}" x2="${W - padR}" y2="${y(t.v)}"/>
      ${t.label ? `<text class="axistext" x="${padL - 8}" y="${y(t.v) + 3.5}"
        text-anchor="end">${Math.round(t.v).toLocaleString('en-IN')}</text>` : ''}`).join('');

    const bars = rows.map((r, i) => {
      const v = value(r);
      const h = Math.max(v > 0 ? 2 : 0, (v / max) * plotH);
      const x = padL + i * band + (band - barW) / 2;
      // 4px rounded cap, square at the baseline.
      const top = padT + plotH - h;
      const rr = Math.min(4, h);
      const d = h <= 0 ? '' :
        `M${x},${padT + plotH} L${x},${top + rr} Q${x},${top} ${x + rr},${top} ` +
        `L${x + barW - rr},${top} Q${x + barW},${top} ${x + barW},${top + rr} ` +
        `L${x + barW},${padT + plotH} Z`;
      return d ? `<path class="bar ${emphasise(r) ? 'peak' : ''}" d="${d}"
        data-tip="${esc(tip(r))}" tabindex="0" role="img" aria-label="${esc(tip(r).replace(/<[^>]+>/g, ' '))}"/>` : '';
    }).join('');

    const labels = rows.map((r, i) => {
      const every = rows.length > 16 ? 3 : 1;
      if (i % every !== 0) return '';
      return `<text class="axistext" x="${padL + i * band + band / 2}" y="${H - 10}"
        text-anchor="middle">${esc(label(r))}</text>`;
    }).join('');

    return `<svg viewBox="0 0 ${W} ${H}" role="img">${grid}${bars}${labels}</svg>`;
  }

  /** Ranked horizontal bars. Value rides the tip; the track shows the whole. */
  function barRows(rows, { name, value, display, sub }) {
    const max = Math.max(1, ...rows.map(value));
    if (!rows.length) return '<p class="empty">Nothing yet.</p>';
    return rows.map((r) => `<div class="hrow">
      <span class="hname" title="${esc(name(r))}">${esc(name(r))}</span>
      <span class="htrack"><span class="hfill" style="width:${Math.max(3, (value(r) / max) * 100)}%"></span></span>
      <span class="hval">${esc(display(r))}${sub ? ` <span class="hsub">${esc(sub(r))}</span>` : ''}</span>
    </div>`).join('');
  }

  async function loadInsights() {
    const days = Number(document.querySelector('.range.is-on').dataset.days);
    let a;
    try { a = await api('/api/admin/analytics?days=' + days); }
    catch { return; }
    state.analytics = a;
    const s = a.summary;

    if (!a.range.has_data) {
      $('insHero').innerHTML = '<p class="empty">No orders in this period yet. ' +
        'Once the restaurant takes orders, this screen fills in.</p>';
      ['insKpis','hourChart','dayChart','topItems','stationLoad','orderTypes','dietSplit']
        .forEach((id) => { $(id).innerHTML = ''; });
      $('peakNote').textContent = '';
      document.querySelector('#insTable tbody').innerHTML = '';
      return;
    }

    // Exactly one hero figure per view.
    $('insHero').innerHTML = `<span class="figure">₹${Math.round(s.revenue).toLocaleString('en-IN')}</span>
      <span class="cap">taken over the last ${days} days, across ${s.orders.toLocaleString('en-IN')} orders</span>`;

    $('insKpis').innerHTML = `
      <div class="stat"><span class="l">Orders</span><b class="n">${s.orders.toLocaleString('en-IN')}</b></div>
      <div class="stat"><span class="l">Dishes served</span><b class="n">${s.items.toLocaleString('en-IN')}</b></div>
      <div class="stat"><span class="l">Average order</span><b class="n">₹${Math.round(s.avg_order_value).toLocaleString('en-IN')}</b></div>
      <div class="stat"><span class="l">Order to ready</span><b class="n">${s.avg_minutes_to_ready == null ? '—' : Math.round(s.avg_minutes_to_ready) + ' min'}</b></div>
      <div class="stat"><span class="l">Busiest hour</span><b class="n">${s.busiest_hour == null ? '—' : hourLabel(s.busiest_hour)}</b>
        <span class="x">${s.busiest_hour_orders} orders</span></div>`;

    // Peak = any hour within 20% of the best. Usually the two service rushes.
    const peakFloor = s.busiest_hour_orders * 0.8;
    const peaks = a.by_hour.filter((h) => h.orders >= peakFloor && h.orders > 0);
    $('peakNote').innerHTML = peaks.length
      ? `Busiest around <b>${peaks.map((h) => hourLabel(h.hour)).join(', ')}</b>. `
        + 'Staff and prep against these, not against the daily average.'
      : '';

    $('hourChart').innerHTML = columnChart(a.by_hour, {
      value: (h) => h.orders,
      label: (h) => hourLabel(h.hour),
      emphasise: (h) => h.orders >= peakFloor && h.orders > 0,
      tip: (h) => `<b>${hourLabel(h.hour)}</b><span>${h.orders} orders · ${h.items} dishes · ₹${Math.round(h.revenue).toLocaleString('en-IN')}</span>`,
    });

    const bestDay = Math.max(...a.by_day.map((d) => d.revenue));
    $('dayChart').innerHTML = columnChart(a.by_day, {
      value: (d) => d.revenue,
      label: (d) => d.weekday,
      emphasise: (d) => d.revenue === bestDay && bestDay > 0,
      tip: (d) => `<b>${esc(d.label)}</b><span>${d.orders} orders · ₹${Math.round(d.revenue).toLocaleString('en-IN')}</span>`,
    });

    $('topItems').innerHTML = barRows(a.top_items, {
      name: (i) => i.name, value: (i) => i.qty,
      display: (i) => i.qty, sub: (i) => compact(i.revenue),
    });

    $('stationLoad').innerHTML = barRows(a.by_station, {
      name: (st) => st.station.replace(/_/g, ' '), value: (st) => st.items,
      display: (st) => Math.round(st.share * 100) + '%', sub: (st) => st.items + ' dishes',
    });

    $('orderTypes').innerHTML = barRows(a.by_order_type, {
      name: (t) => t.type.replace(/_/g, ' '), value: (t) => t.orders,
      display: (t) => Math.round(t.share * 100) + '%', sub: (t) => t.orders + ' orders',
    });

    const d = a.diet_split;
    const dietTotal = d.VEG + d.EGG + d.NON_VEG || 1;
    $('dietSplit').innerHTML = barRows(
      [{ k: 'Veg', v: d.VEG }, { k: 'Egg', v: d.EGG }, { k: 'Non-veg', v: d.NON_VEG }], {
        name: (r) => r.k, value: (r) => r.v,
        display: (r) => Math.round((r.v / dietTotal) * 100) + '%', sub: (r) => r.v + ' dishes',
      });

    loadGst(days);

    document.querySelector('#insTable tbody').innerHTML = a.by_hour.map((h) => `<tr>
      <td class="num">${hourLabel(h.hour)}</td><td class="num">${h.orders}</td>
      <td class="num">${h.items}</td><td class="num">₹${Math.round(h.revenue).toLocaleString('en-IN')}</td>
    </tr>`).join('');
  }

  const money2 = (n) => '₹' + Number(n).toLocaleString('en-IN',
    { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  /** The tax view. Hidden entirely when GST is not switched on. */
  async function loadGst(days) {
    let g;
    try { g = await api('/api/admin/gst?days=' + days); }
    catch { $('gstPanel').hidden = true; return; }

    if (!g.enabled) { $('gstPanel').hidden = true; return; }
    $('gstPanel').hidden = false;

    const gap = g.series_gaps.length
      ? `<div class="gstwarn"><strong>The invoice series has a gap.</strong>
           ${g.series_gaps.map((x) => `${x.financial_year}: nothing between ${x.after} and ${x.before}`).join('; ')}.
           An auditor will ask about this.</div>`
      : '';

    $('gstSummary').innerHTML = gap + `<div class="gstgrid">
      <div class="gstcell"><span class="l">Invoices</span><b class="n">${g.count}</b></div>
      <div class="gstcell"><span class="l">Taxable value</span><b class="n">${money2(g.taxable_value)}</b></div>
      <div class="gstcell"><span class="l">CGST @ ${g.rate / 2}%</span><b class="n">${money2(g.cgst_amount)}</b></div>
      <div class="gstcell"><span class="l">SGST @ ${g.rate / 2}%</span><b class="n">${money2(g.sgst_amount)}</b></div>
      <div class="gstcell"><span class="l">Total billed</span><b class="n">${money2(g.total)}</b></div>
    </div>
    <p class="cardnote" style="margin-top:12px">GSTIN ${esc(g.gstin)}${g.first ? ` · ${esc(g.first)} to ${esc(g.last)}` : ''}</p>`;

    document.querySelector('#gstTable tbody').innerHTML = g.invoices.length
      ? g.invoices.slice().reverse().map((i) => `<tr>
          <td class="linkcell">${esc(i.invoice_no)}</td>
          <td class="num">${clock(i.issued_at)}</td>
          <td class="num">${money2(i.taxable_value)}</td>
          <td class="num">${money2(i.cgst_amount)}</td>
          <td class="num">${money2(i.sgst_amount)}</td>
          <td class="num">${money2(i.round_off)}</td>
          <td class="num"><strong>${money2(i.total)}</strong></td>
        </tr>`).join('')
      : '<tr><td colspan="7" class="empty">No invoices in this period.</td></tr>';
  }

  document.querySelectorAll('.range').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('.range').forEach((x) => x.classList.remove('is-on'));
    b.classList.add('is-on');
    loadInsights();
  }));

  // Hover and keyboard focus both raise the tooltip; the bar is the hit target.
  document.addEventListener('mouseover', (e) => {
    const m = e.target.closest('[data-tip]');
    if (m) vizTip(m.dataset.tip, e);
  });
  document.addEventListener('mousemove', (e) => {
    const m = e.target.closest('[data-tip]');
    if (m) vizTip(m.dataset.tip, e);
  });
  document.addEventListener('mouseout', (e) => {
    if (e.target.closest('[data-tip]')) vizTip(null);
  });
  document.addEventListener('focusin', (e) => {
    const m = e.target.closest('[data-tip]');
    if (!m) return;
    const r = m.getBoundingClientRect();
    vizTip(m.dataset.tip, { clientX: r.left + r.width / 2, clientY: r.top });
  });
  document.addEventListener('focusout', (e) => {
    if (e.target.closest('[data-tip]')) vizTip(null);
  });

  /* ------------------------------------------------------------- socket */

  function connect() {
    const socket = io({ transports: ['websocket', 'polling'] });
    state.socket = socket;
    socket.on('connect', () => {
      $('conn').dataset.state = 'on'; $('conn').textContent = 'Live';
      socket.emit(EVENTS.JOIN_ADMIN, {}, (snap) => {
        if (snap && snap.login_required) return toLogin();
        if (snap && snap.staff) renderWhoami(snap.staff);
        loadToday();
      });
    });
    socket.on('disconnect', () => {
      $('conn').dataset.state = 'off'; $('conn').textContent = 'Offline';
    });
    socket.on(EVENTS.NEW_ORDER, loadToday);
    socket.on(EVENTS.ORDER_STATUS_CHANGED, loadToday);
  }

  connect();
  loadToday();
  loadMenu().catch(() => {});
  setInterval(loadToday, 30000);
})();
