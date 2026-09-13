/* End-to-end check of the Phase 0 + Phase 1 flow. Run with the server up. */
const BASE = process.env.BASE || 'http://localhost:3000';
const { io } = require('socket.io-client');
const auth = require('../server/services/authService');
const fixtures = require('./fixtures');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? '  PASS' : '! FAIL'}  ${name}${extra ? '  — ' + extra : ''}`);
};
const section = (t) => console.log(`\n-- ${t}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* The suite runs against the same database as the server, so it can set known
   PINs rather than trying to guess the random ones the seed printed. */
const MANAGER_PIN = '911911';
const KITCHEN_PIN = '822822';

function ensureStaff(name, role, pin) {
  const existing = auth.listStaff().find((s) => s.name === name);
  if (existing) { auth.changePin(existing.id, pin); auth.setStaffActive(existing.id, true); return existing; }
  return auth.createStaff({ name, role, pin });
}

let mgr = '', kit = '';
const H = (cookie, extra = {}) => ({ 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...extra });
const get = (p, cookie) => fetch(BASE + p, { headers: H(cookie) }).then((r) => r.json());
const getRaw = (p, cookie) => fetch(BASE + p, { headers: H(cookie) });
const post = (p, b, cookie) => fetch(BASE + p, {
  method: 'POST', headers: H(cookie), body: JSON.stringify(b),
}).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));

async function login(pin) {
  const res = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin }),
  });
  const setCookie = res.headers.get('set-cookie') || '';
  return { status: res.status, cookie: setCookie.split(';')[0], body: await res.json().catch(() => ({})) };
}

(async () => {
  console.log('\n=== Liquid Sky — end-to-end (Phase 0 + Phase 1) ===');

  ensureStaff('E2E Manager', 'MANAGER', MANAGER_PIN);
  ensureStaff('E2E Kitchen', 'KITCHEN', KITCHEN_PIN);

  /* ------------------------------------------------------------ AUTH */
  section('Phase 1 — staff PIN');
  const badLogin = await login('000000');
  ok('a wrong PIN is refused', badLogin.status === 400, badLogin.body.error);

  const m = await login(MANAGER_PIN);
  ok('manager PIN signs in', m.status === 200 && !!m.cookie);
  ok('manager identified', m.body.staff && m.body.staff.role === 'MANAGER', m.body.staff && m.body.staff.name);
  mgr = m.cookie;

  const k = await login(KITCHEN_PIN);
  ok('kitchen PIN signs in', k.status === 200 && !!k.cookie);
  kit = k.cookie;

  ok('/api/admin refuses an anonymous caller',
     (await getRaw('/api/admin/service-points')).status === 401);
  ok('/api/admin refuses a kitchen PIN',
     (await getRaw('/api/admin/service-points', kit)).status === 403);
  ok('/api/admin accepts a manager',
     (await getRaw('/api/admin/service-points', mgr)).status === 200);
  ok('/api/orders/active refuses an anonymous caller',
     (await getRaw('/api/orders/active')).status === 401);
  ok('/api/orders/active accepts a kitchen PIN',
     (await getRaw('/api/orders/active', kit)).status === 200);
  ok('/api/orders/today refuses a kitchen PIN',
     (await getRaw('/api/orders/today', kit)).status === 403);

  const adminPage = await fetch(BASE + '/admin', { redirect: 'manual' });
  ok('/admin redirects a signed-out browser to the keypad',
     adminPage.status === 302 && (adminPage.headers.get('location') || '').startsWith('/login'));
  const kitchenPage = await fetch(BASE + '/kitchen/', { redirect: 'manual', headers: H(kit) });
  ok('/kitchen serves a signed-in kitchen tablet', kitchenPage.status === 200);
  const kitchenAsNobody = await fetch(BASE + '/kitchen', { redirect: 'manual' });
  ok('/kitchen redirects when signed out', kitchenAsNobody.status === 302);
  const adminAsKitchen = await fetch(BASE + '/admin/', { redirect: 'manual', headers: H(kit) });
  ok('/admin sends a kitchen PIN to the kitchen, not back to the keypad',
     adminAsKitchen.status === 302 && adminAsKitchen.headers.get('location') === '/kitchen/',
     adminAsKitchen.headers.get('location'));
  ok('/login is reachable without signing in', (await fetch(BASE + '/login')).status === 200);
  ok('the session cookie is HttpOnly', /HttpOnly/i.test(m.cookie + (await login(MANAGER_PIN)).cookie) ||
     true === false ? true : /HttpOnly/i.test((await fetch(BASE + '/api/auth/login', {
       method: 'POST', headers: { 'Content-Type': 'application/json' },
       body: JSON.stringify({ pin: MANAGER_PIN }) })).headers.get('set-cookie') || ''));

  section('Phase 1 — PIN rules');
  ok('a duplicate PIN is refused',
     (await post('/api/auth/staff', { name: 'Clash', role: 'KITCHEN', pin: MANAGER_PIN }, mgr)).body.error
       ?.includes('already taken'));
  ok('a 3-digit PIN is refused',
     (await post('/api/auth/staff', { name: 'Shorty', role: 'KITCHEN', pin: '123' }, mgr)).body.error
       ?.includes('4 to 8 digits'));

  /* ------------------------------------------------------------ SETUP */
  const points = (await get('/api/admin/service-points', mgr)).service_points;
  const table = points.find((p) => p.label === 'Table 1');
  const other = points.find((p) => p.label === 'Table 2');
  const menu = (await get('/api/menu')).categories;
  const items = menu.flatMap((c) => c.items);
  console.log(`\n  ${points.length} service points, ${items.length} dishes on the menu`);

  section('Defect 01 — unguessable QR identifiers');
  ok('slug is not the table id', !/^\d+$/.test(table.qr_slug), `slug=${table.qr_slug}`);
  ok('/t/1 is rejected', (await fetch(BASE + '/t/1')).status === 404);
  ok('/t/<real slug> serves the menu page', (await fetch(BASE + '/t/' + table.qr_slug)).status === 200);
  ok('the public menu needs no sign-in', (await getRaw('/api/menu')).status === 200);
  ok('the owner menu does need one', (await getRaw('/api/menu/all')).status === 401,
     'it shows sold-out dishes and which counter cooks what');
  ok('staff can read the owner menu', (await getRaw('/api/menu/all', mgr)).status === 200);

  section('An order across three stations');
  const [ghee, biry, gobi] = fixtures.distinctStations(items, 3);
  const clientId = 'e2e-' + Date.now();
  const payload = {
    client_order_id: clientId, qr_slug: table.qr_slug, notes: 'One extra plate please',
    items: [
      { menu_item_id: ghee.id, quantity: 1, special_notes: 'Extra spicy' },
      { menu_item_id: biry.id, quantity: 2 },
      { menu_item_id: gobi.id, quantity: 1 },
    ],
  };
  const first = await post('/api/orders', payload);
  ok('a customer can order without signing in', first.status === 201);
  const order = first.body.order;
  const expected = ghee.price + biry.price * 2 + gobi.price;
  ok('total is correct', order.total === expected, `${order.total} = ${expected}`);
  ok('eta is the slowest station', order.eta_minutes === Math.max(ghee.prep_minutes, biry.prep_minutes, gobi.prep_minutes), `${order.eta_minutes} min`);
  ok('stations routed', new Set(order.items.map((i) => i.station)).size === 3,
     [...new Set(order.items.map((i) => i.station))].join(', '));
  ok('diet snapshotted', order.items.every((i) => ['VEG', 'EGG', 'NON_VEG'].includes(i.diet_type)));
  ok('special note kept', order.items.find((i) => i.name === ghee.name).special_notes === 'Extra spicy');
  ok('order type inferred from service point', order.order_type === 'DINE_IN');

  section('Phase 1 — one table cannot read another table\'s order');
  ok('the right slug reads the order',
     (await getRaw(`/api/orders/${order.id}?slug=${table.qr_slug}`)).status === 200);
  ok('a different table\'s slug is refused',
     (await getRaw(`/api/orders/${order.id}?slug=${other.qr_slug}`)).status === 404);
  ok('no slug at all is refused', (await getRaw(`/api/orders/${order.id}`)).status === 404);
  ok('staff can read any order', (await getRaw(`/api/orders/${order.id}`, mgr)).status === 200);

  section('Defect 03 — double-tap does not double-order');
  const second = await post('/api/orders', payload);
  ok('repeat returns 200, not 201', second.status === 200);
  ok('same order id returned', second.body.order.id === order.id, `#${order.id}`);
  ok('flagged as duplicate', second.body.duplicate === true);
  ok('exactly one order exists',
     (await get('/api/orders/active', kit)).orders.filter((o) => o.id === order.id).length === 1);

  section('Defect 02 — editing the menu does not rewrite history');
  const newPrice = ghee.price + 100;
  await fetch(`${BASE}/api/admin/menu-items/${ghee.id}`, {
    method: 'PUT', headers: H(mgr), body: JSON.stringify({ ...ghee, price: newPrice }) });
  const after = (await get(`/api/orders/${order.id}`, mgr)).order;
  ok('historical total unchanged', after.total === expected, `${after.total} still = ${expected}`);
  ok('historical line price unchanged', after.items.find((i) => i.name === ghee.name).price === ghee.price);
  ok('live menu shows the new price',
     (await get('/api/menu')).categories.flatMap((c) => c.items).find((i) => i.id === ghee.id).price === newPrice);
  await fetch(`${BASE}/api/admin/menu-items/${ghee.id}`, {
    method: 'PUT', headers: H(mgr), body: JSON.stringify({ ...ghee, price: ghee.price }) });

  section('Deleting a dish leaves order history intact');
  const doomed = (await post('/api/admin/menu-items', {
    name: 'Test Dish To Delete', price: 99, diet_type: 'VEG', station: 'CURRY',
    category_id: menu[0].id, prep_minutes: 5 }, mgr)).body.item;
  const o2 = (await post('/api/orders', {
    client_order_id: 'e2e-del-' + Date.now(), qr_slug: table.qr_slug,
    items: [{ menu_item_id: doomed.id, quantity: 1 }] })).body.order;
  await fetch(`${BASE}/api/admin/menu-items/${doomed.id}`, { method: 'DELETE', headers: H(mgr) });
  const o2after = (await get(`/api/orders/${o2.id}`, mgr)).order;
  ok('deleted dish keeps its name in history', o2after.items[0].name === 'Test Dish To Delete');
  ok('deleted dish keeps its price', o2after.items[0].price === 99);

  /* --------------------------------------------------------- REALTIME */
  section('Realtime — kitchen and customer stay in sync');
  const kitchen = io(BASE, { transports: ['websocket'], extraHeaders: { Cookie: kit } });
  const customer = io(BASE, { transports: ['websocket'] });
  const anon = io(BASE, { transports: ['websocket'] });
  const kitchenSaw = [], customerSaw = [];

  await new Promise((r) => kitchen.on('connect', r));
  await new Promise((r) => customer.on('connect', r));
  await new Promise((r) => anon.on('connect', r));

  const anonJoin = await new Promise((r) => anon.emit('join_kitchen', { last_seq: 0 }, r));
  ok('a socket with no session cannot join the kitchen', anonJoin && anonJoin.login_required === true);

  const snapshot = await new Promise((r) => kitchen.emit('join_kitchen', { last_seq: 0 }, r));
  ok('a signed-in kitchen socket gets a snapshot', Array.isArray(snapshot.active_orders));
  ok('the snapshot says who is signed in', snapshot.staff && snapshot.staff.name === 'E2E Kitchen');

  const wrongRoom = await new Promise((r) =>
    customer.emit('join_order', { order_id: order.id, qr_slug: other.qr_slug }, r));
  ok('a customer cannot join another table\'s order room', !!(wrongRoom && wrongRoom.error));
  await new Promise((r) => customer.emit('join_order', { order_id: order.id, qr_slug: table.qr_slug }, r));

  kitchen.on('order_status_changed', ({ order: o }) => kitchenSaw.push(o.status));
  customer.on('order_status_changed', ({ order: o }) => customerSaw.push(o.status));

  const anonWrite = await new Promise((r) =>
    anon.emit('update_order_status', { order_id: order.id, status: 'PREPARING' }, r));
  ok('a socket with no session cannot change an order', anonWrite && anonWrite.ok === false);

  for (const status of ['PREPARING', 'READY', 'SERVED']) {
    await new Promise((r) => kitchen.emit('update_order_status', { order_id: order.id, status }, r));
    await sleep(120);
  }
  ok('kitchen saw all three transitions', kitchenSaw.join('>') === 'PREPARING>READY>SERVED', kitchenSaw.join(' > '));
  ok('customer saw all three transitions', customerSaw.join('>') === 'PREPARING>READY>SERVED', customerSaw.join(' > '));

  const served = (await get(`/api/orders/${order.id}`, mgr)).order;
  ok('served_at recorded', !!served.served_at);
  ok('items follow the order status', served.items.every((i) => i.item_status === 'SERVED'));
  ok('served order leaves the active board',
     !(await get('/api/orders/active', kit)).orders.some((o) => o.id === order.id));

  section('Phase 1 — the order records who served it');
  ok('server_name is the signed-in staff member', served.server_name === 'E2E Kitchen', served.server_name);

  section('Invalid transitions are refused');
  const bad = await post(`/api/orders/${order.id}/status`, { status: 'PREPARING' }, kit);
  ok('cannot un-serve an order', bad.status === 400, bad.body.error);

  section('Defect 04 — a tablet that dropped wifi gets the gap replayed');
  const seqBefore = (await get('/api/orders/active', kit)).last_seq;
  kitchen.disconnect();
  const missed = (await post('/api/orders', {
    client_order_id: 'e2e-missed-' + Date.now(), qr_slug: table.qr_slug,
    items: [{ menu_item_id: biry.id, quantity: 1 }] })).body.order;
  ok('order placed while kitchen was offline', !!missed.id, `#${missed.id}`);

  const kitchen2 = io(BASE, { transports: ['websocket'], extraHeaders: { Cookie: kit } });
  await new Promise((r) => kitchen2.on('connect', r));
  const replay = await new Promise((r) => kitchen2.emit('join_kitchen', { last_seq: seqBefore }, r));
  ok('missed order came back in the replay',
     replay.events.filter((e) => e.type === 'new_order').map((e) => e.payload.order.id).includes(missed.id),
     `replayed ${replay.events.length} event(s)`);
  ok('replay advances the cursor', replay.last_seq > seqBefore, `${seqBefore} -> ${replay.last_seq}`);
  ok('replay reports whether it was truncated', replay.truncated === false);

  section('Bad input is refused with a message a customer can read');
  ok('empty cart refused', (await post('/api/orders', {
    client_order_id: 'e2e-empty-' + Date.now(), qr_slug: table.qr_slug, items: [] })).body.error === 'Your order is empty');
  ok('unknown slug refused', /not valid/.test((await post('/api/orders', {
    client_order_id: 'e2e-slug-' + Date.now(), qr_slug: 'nope',
    items: [{ menu_item_id: biry.id, quantity: 1 }] })).body.error));
  ok('zero quantity refused', /between 1 and 50/.test((await post('/api/orders', {
    client_order_id: 'e2e-qty-' + Date.now(), qr_slug: table.qr_slug,
    items: [{ menu_item_id: biry.id, quantity: 0 }] })).body.error));
  await post(`/api/admin/menu-items/${biry.id}/availability`, { is_available: false }, mgr);
  ok('sold-out dish refused', /run out/.test((await post('/api/orders', {
    client_order_id: 'e2e-out-' + Date.now(), qr_slug: table.qr_slug,
    items: [{ menu_item_id: biry.id, quantity: 1 }] })).body.error));
  await post(`/api/admin/menu-items/${biry.id}/availability`, { is_available: true }, mgr);

  section('QR codes');
  const qr = await getRaw(`/api/admin/service-points/${table.id}/qr.png`, mgr);
  ok('single QR PNG downloads', qr.status === 200 && qr.headers.get('content-type').includes('png'));
  const sheetHtml = await (await getRaw('/api/admin/qr-sheet', mgr)).text();
  ok('print sheet renders every active point',
     (sheetHtml.match(/class="card"/g) || []).length === points.filter((p) => p.is_active).length);
  ok('print sheet warns about the base URL', sheetHtml.includes('PUBLIC_BASE_URL'));

  section('Phase 1 — signing out ends the session');
  const outCookie = (await login(MANAGER_PIN)).cookie;
  ok('session works before sign out', (await getRaw('/api/auth/me', outCookie)).status === 200);
  await fetch(BASE + '/api/auth/logout', { method: 'POST', headers: H(outCookie) });
  ok('session is dead after sign out', (await getRaw('/api/auth/me', outCookie)).status === 401);

  kitchen2.disconnect(); customer.disconnect(); anon.disconnect();
  console.log(`\n=== ${pass} passed, ${fail} failed ===\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('\nCRASHED:', e); process.exit(1); });
