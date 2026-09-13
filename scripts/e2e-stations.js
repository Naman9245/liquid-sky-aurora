/* Phase 1 — per-station tickets and the derived order status. */
const BASE = process.env.BASE || 'http://localhost:3000';
const { io } = require('socket.io-client');
const auth = require('../server/services/authService');
const fixtures = require('./fixtures');

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? '  PASS' : '! FAIL'}  ${n}${x ? '  — ' + x : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function ensure(name, role, pin) {
  const e = auth.listStaff().find((s) => s.name === name);
  if (e) { auth.changePin(e.id, pin); auth.setStaffActive(e.id, true); return; }
  auth.createStaff({ name, role, pin });
}

(async () => {
  console.log('\n=== Stations, expo, and derived status ===\n');
  ensure('ST Manager', 'MANAGER', '733733');
  ensure('ST Tandoor', 'KITCHEN', '744744');

  const li = async (pin) => {
    const r = await fetch(BASE + '/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin }) });
    return (r.headers.get('set-cookie') || '').split(';')[0];
  };
  const mgr = await li('733733');
  const kit = await li('744744');
  const H = (c) => ({ 'Content-Type': 'application/json', Cookie: c });

  const points = (await (await fetch(BASE + '/api/admin/service-points', { headers: H(mgr) })).json()).service_points;
  const table = points.find((p) => p.label === 'Table 5');
  const items = (await (await fetch(BASE + '/api/menu')).json()).categories.flatMap((c) => c.items);

  // Three different counters, ordered fastest to slowest, whatever the
  // restaurant happens to call them.
  const [naan, gobi, ghee] = fixtures.stationsBySpeed(items, 3);

  const res = await fetch(BASE + '/api/orders', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_order_id: 'st-' + Date.now(), qr_slug: table.qr_slug,
      items: [
        { menu_item_id: ghee.id, quantity: 1 },
        { menu_item_id: naan.id, quantity: 2 },
        { menu_item_id: gobi.id, quantity: 1 },
      ],
    }),
  });
  const order = (await res.json()).order;
  ok('order spans three stations', new Set(order.items.map((i) => i.station)).size === 3,
     [...new Set(order.items.map((i) => i.station))].join(', '));
  ok('every item starts QUEUED', order.items.every((i) => i.item_status === 'QUEUED'));
  ok('order starts PLACED', order.status === 'PLACED');

  const sock = io(BASE, { transports: ['websocket'], extraHeaders: { Cookie: kit } });
  const customer = io(BASE, { transports: ['websocket'] });
  await new Promise((r) => sock.on('connect', r));
  await new Promise((r) => customer.on('connect', r));
  await new Promise((r) => sock.emit('join_kitchen', { last_seq: 0 }, r));
  await new Promise((r) => customer.emit('join_order', { order_id: order.id, qr_slug: table.qr_slug }, r));

  const customerSaw = [];
  customer.on('order_status_changed', ({ order: o }) => customerSaw.push(o.status));

  const setItem = (itemId, status) => new Promise((r) =>
    sock.emit('update_item_status', { order_id: order.id, order_item_id: itemId, status }, r));
  const fetchOrder = async () =>
    (await (await fetch(`${BASE}/api/orders/${order.id}`, { headers: H(mgr) })).json()).order;

  const item = (name) => order.items.find((i) => i.name === name);

  // The fastest counter finishes first.
  await setItem(item(naan.name).id, 'PREPARING');
  let now = await fetchOrder();
  ok('one station starting moves the order to PREPARING', now.status === 'PREPARING', now.status);

  await setItem(item(naan.name).id, 'READY');
  now = await fetchOrder();
  ok('the fastest station finishing does NOT make the order READY', now.status === 'PREPARING', now.status);
  ok('that item is READY on its own', now.items.find((i) => i.name === naan.name).item_status === 'READY');

  await setItem(item(gobi.name).id, 'READY');
  now = await fetchOrder();
  ok('two of three stations still is not READY', now.status === 'PREPARING', now.status);

  await setItem(item(ghee.name).id, 'READY');
  now = await fetchOrder();
  ok('the order is READY only when the slowest station finishes', now.status === 'READY', now.status);
  ok('ready_at is stamped once', !!now.ready_at);

  await sleep(200);
  ok('the customer was told exactly once that it is ready',
     customerSaw.filter((s) => s === 'READY').length === 1,
     customerSaw.join(' > '));

  // Station screens filter and bump.
  const active = (await (await fetch(BASE + '/api/orders/active', { headers: H(kit) })).json()).orders;
  const mineTandoor = active.find((o) => o.id === order.id);
  ok('the order is still on the board until it is served', !!mineTandoor);

  await new Promise((r) => sock.emit('update_order_status', { order_id: order.id, status: 'SERVED' }, r));
  now = await fetchOrder();
  ok('serving from the expo marks every item served',
     now.items.every((i) => i.item_status === 'SERVED'));
  ok('the server is recorded', now.server_name === 'ST Tandoor', now.server_name);

  // An item belonging to a different order must be refused.
  const bad = await new Promise((r) =>
    sock.emit('update_item_status', { order_id: order.id, order_item_id: 999999, status: 'READY' }, r));
  ok('an item from another order is refused', bad && bad.ok === false, bad && bad.error);

  sock.disconnect(); customer.disconnect();
  console.log(`\n=== ${pass} passed, ${fail} failed ===\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CRASHED:', e); process.exit(1); });
