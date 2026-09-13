/* Phase 1 — kitchen tickets and bills. */
const BASE = process.env.BASE || 'http://localhost:3000';
const auth = require('../server/services/authService');
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? '  PASS' : '! FAIL'}  ${n}${x ? '  — ' + x : ''}`); };

(async () => {
  console.log('\n=== Kitchen tickets and bills ===\n');
  const mk = (name, role, pin) => {
    const e = auth.listStaff().find((s) => s.name === name);
    if (e) { auth.changePin(e.id, pin); auth.setStaffActive(e.id, true); return; }
    auth.createStaff({ name, role, pin });
  };
  mk('Print Manager', 'MANAGER', '911411'); mk('Print Cook', 'KITCHEN', '922422');
  const li = async (pin) => {
    const r = await fetch(BASE + '/api/auth/login', { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin }) });
    return (r.headers.get('set-cookie') || '').split(';')[0];
  };
  const mgr = await li('911411'), kit = await li('922422');
  const H = (c) => ({ 'Content-Type': 'application/json', Cookie: c });

  const pts = (await (await fetch(BASE + '/api/admin/service-points', { headers: H(mgr) })).json()).service_points;
  const table = pts.find((p) => p.label === 'Table 9');
  const items = (await (await fetch(BASE + '/api/menu')).json()).categories.flatMap((c) => c.items);
  // A non-veg dish (the ticket marks it for the cook) and a tandoor dish
  // (so the station ticket has something to filter to) — picked by
  // attribute, because naming dishes couples the suite to one menu.
  // Names go through HTML escaping on the way to the ticket, so a dish
  // called "Chicken — Manchurian / Chilly / Salt & Pepper" would never
  // match a plain includes(). Fixtures skip names carrying markup
  // characters rather than the assertions having to un-escape.
  const plain = (i) => i.price > 0 && !/[&<>"']/.test(i.name);
  const nonveg = items.find((i) => plain(i) && i.diet_type === 'NON_VEG' && i.station !== 'TANDOOR');
  const bread  = items.find((i) => plain(i) && i.station === 'TANDOOR');

  const order = (await (await fetch(BASE + '/api/orders', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_order_id: 'pr-' + Date.now(), qr_slug: table.qr_slug,
      notes: 'No onion anywhere',
      items: [
        { menu_item_id: nonveg.id, quantity: 1, special_notes: 'Extra spicy' },
        { menu_item_id: bread.id, quantity: 4 },
      ] }) })).json()).order;

  const kotOut = await fetch(`${BASE}/api/print/kot/${order.id}`, { redirect: 'manual' });
  const billOut = await fetch(`${BASE}/api/print/bill/${order.id}`, { redirect: 'manual' });
  ok('a signed-out ticket sends the cook to the keypad, not to JSON',
     kotOut.status === 302 && (kotOut.headers.get('location') || '').startsWith('/login'),
     kotOut.headers.get('location'));
  ok('a signed-out bill sends them to the keypad too',
     billOut.status === 302 && (billOut.headers.get('location') || '').startsWith('/login'));

  const kot = await (await fetch(`${BASE}/api/print/kot/${order.id}`, { headers: H(kit) })).text();
  ok('the ticket names the table in large type', kot.includes('class="mid huge">Table 9'));
  ok('the ticket lists both dishes', kot.includes(nonveg.name) && kot.includes(bread.name));
  ok('the ticket carries the dish note', kot.includes('Extra spicy'));
  ok('the ticket carries the table note', kot.includes('No onion anywhere'));
  ok('the ticket marks non-veg for the cook', kot.includes(nonveg.name + ' (N)'));
  ok('the ticket is sized for an 80mm roll', kot.includes('size: 80mm auto'));
  ok('the ticket shows no prices', !kot.includes('₹'));

  const tandoor = await (await fetch(`${BASE}/api/print/kot/${order.id}?station=TANDOOR`, { headers: H(kit) })).text();
  ok('a station ticket prints only that station', tandoor.includes(bread.name) && !tandoor.includes(nonveg.name));
  ok('a station with nothing on this order is refused',
     (await fetch(`${BASE}/api/print/kot/${order.id}?station=DESSERT`, { headers: H(kit) })).status === 404);

  const bill = await (await fetch(`${BASE}/api/print/bill/${order.id}`, { headers: H(mgr) })).text();
  ok('the bill shows the total', bill.includes('TOTAL'));
  ok('the bill shows the right amount', bill.includes(`₹${order.total.toLocaleString('en-IN')}`), `₹${order.total}`);
  ok('the bill carries the restaurant address',
     bill.includes(require('../server/config').RESTAURANT.address.split(',')[0].trim()));
  // Which of these is correct depends on whether GST is switched on. Without a
  // GSTIN the bill must disclaim; with one it must be a proper tax invoice.
  const gstOn = require('../server/config').GST.enabled;
  ok(gstOn ? 'with GST on, the bill IS a tax invoice'
           : 'without GST, the bill says it is not a tax invoice',
     gstOn ? bill.includes('TAX INVOICE') && !bill.includes('not a tax invoice')
           : bill.includes('not a tax invoice'),
     gstOn ? 'GSTIN configured' : 'no GSTIN configured');
  ok('a missing order is a 404', (await fetch(`${BASE}/api/print/bill/999999`, { headers: H(mgr) })).status === 404);

  console.log(`\n=== ${pass} passed, ${fail} failed ===\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CRASHED:', e); process.exit(1); });
