/* Phase 1 — paying by UPI and the review nudge. */
const BASE = process.env.BASE || 'http://localhost:3000';
const auth = require('../server/services/authService');
const fixtures = require('./fixtures');

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? '  PASS' : '! FAIL'}  ${n}${x ? '  — ' + x : ''}`); };

(async () => {
  console.log('\n=== Paying by UPI + the review nudge ===\n');
  const e = auth.listStaff().find((s) => s.name === 'Bill Manager')
    || auth.createStaff({ name: 'Bill Manager', role: 'MANAGER', pin: '655655' });
  auth.changePin(e.id, '655655');

  const r = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: '655655' }) });
  const mgr = (r.headers.get('set-cookie') || '').split(';')[0];
  const H = { 'Content-Type': 'application/json', Cookie: mgr };

  const cfg = await (await fetch(BASE + '/api/config')).json();
  console.log(`  UPI configured on this server: ${cfg.upi_enabled ? 'yes' : 'no'}`);
  console.log(`  Review link configured:        ${cfg.review.enabled ? 'yes' : 'no'}\n`);

  ok('public config never leaks the VPA itself', !JSON.stringify(cfg).includes('@'), JSON.stringify(cfg.restaurant.name));
  ok('public config names the restaurant', !!cfg.restaurant.name);

  const pts = (await (await fetch(BASE + '/api/admin/service-points', { headers: H })).json()).service_points;
  const table = pts.find((p) => p.label === 'Table 7');
  const other = pts.find((p) => p.label === 'Table 8');
  const items = (await (await fetch(BASE + '/api/menu')).json()).categories.flatMap((c) => c.items);
  const biry = fixtures.anyDish(items);

  const order = (await (await fetch(BASE + '/api/orders', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_order_id: 'bill-' + Date.now(), qr_slug: table.qr_slug,
      items: [{ menu_item_id: biry.id, quantity: 2 }] }) })).json()).order;

  const qr = await fetch(`${BASE}/api/orders/${order.id}/upi-qr.png?slug=${table.qr_slug}`);
  const link = await fetch(`${BASE}/api/orders/${order.id}/upi-link?slug=${table.qr_slug}`);

  if (cfg.upi_enabled) {
    ok('the UPI QR renders', qr.status === 200 && qr.headers.get('content-type').includes('png'));
    const body = await link.json();
    ok('the deep link is a upi:// intent', body.link.startsWith('upi://pay?'), body.link);
    ok('the deep link carries this order\'s exact amount',
       body.link.includes(`am=${order.total.toFixed(2)}`), `total ₹${order.total}`);
    ok('the deep link is in rupees', body.link.includes('cu=INR'));
    ok('another table cannot pull this bill',
       (await fetch(`${BASE}/api/orders/${order.id}/upi-qr.png?slug=${other.qr_slug}`)).status === 404);
    ok('no slug cannot pull this bill',
       (await fetch(`${BASE}/api/orders/${order.id}/upi-qr.png`)).status === 404);
  } else {
    ok('with no UPI id set the QR is not served, rather than showing a wrong payee',
       qr.status === 404);
    ok('with no UPI id set the deep link is not served', link.status === 404);
    ok('the customer page is told UPI is off, so it hides the panel', cfg.upi_enabled === false);
  }

  ok('the review block only appears when a link is configured',
     typeof cfg.review.enabled === 'boolean' && (!cfg.review.enabled || /^https:\/\//.test(cfg.review.url)));

  console.log(`\n=== ${pass} passed, ${fail} failed ===\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CRASHED:', e); process.exit(1); });
