/* Phase 2 — analytics. Checks the numbers, not the pixels. */
const BASE = process.env.BASE || 'http://localhost:3000';
const auth = require('../server/services/authService');
const analytics = require('../server/services/analyticsService');
const { db } = require('../server/db');

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? '  PASS' : '! FAIL'}  ${n}${x ? '  — ' + x : ''}`); };

(async () => {
  console.log('\n=== Analytics ===\n');
  const e = auth.listStaff().find((s) => s.name === 'An Manager')
    || auth.createStaff({ name: 'An Manager', role: 'MANAGER', pin: '744911' });
  auth.changePin(e.id, '744911');
  const k = auth.listStaff().find((s) => s.name === 'An Cook')
    || auth.createStaff({ name: 'An Cook', role: 'KITCHEN', pin: '755922' });
  auth.changePin(k.id, '755922');

  const li = async (pin) => {
    const r = await fetch(BASE + '/api/auth/login', { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin }) });
    return (r.headers.get('set-cookie') || '').split(';')[0];
  };
  const mgr = await li('744911'), kit = await li('755922');

  ok('analytics needs a manager PIN',
     (await fetch(BASE + '/api/admin/analytics')).status === 401);
  ok('a kitchen PIN cannot see the books',
     (await fetch(BASE + '/api/admin/analytics', { headers: { Cookie: kit } })).status === 403);

  const res = await fetch(BASE + '/api/admin/analytics?days=7', { headers: { Cookie: mgr } });
  ok('a manager can', res.status === 200);
  const a = await res.json();

  ok('every hour of the day has a bucket', a.by_hour.length === 24,
     'the restaurant runs 24 hours, so all 24 are real');
  ok('hours are 0 to 23 in order', a.by_hour.every((h, i) => h.hour === i));
  ok('the day range matches what was asked', a.by_day.length === 7);

  const hourOrders = a.by_hour.reduce((s, h) => s + h.orders, 0);
  ok('hourly orders add up to the total', hourOrders === a.summary.orders,
     `${hourOrders} vs ${a.summary.orders}`);
  const dayOrders = a.by_day.reduce((s, d) => s + d.orders, 0);
  ok('daily orders add up to the total', dayOrders === a.summary.orders,
     `${dayOrders} vs ${a.summary.orders}`);
  const hourRev = a.by_hour.reduce((s, h) => s + h.revenue, 0);
  ok('hourly takings add up to the total', Math.abs(hourRev - a.summary.revenue) < 0.01,
     `₹${Math.round(hourRev)} vs ₹${Math.round(a.summary.revenue)}`);

  const stationItems = a.by_station.reduce((s, x) => s + x.items, 0);
  ok('every dish is counted against a station', stationItems === a.summary.items,
     `${stationItems} vs ${a.summary.items}`);
  ok('station shares total 100%',
     Math.abs(a.by_station.reduce((s, x) => s + x.share, 0) - (a.summary.items ? 1 : 0)) < 0.001);

  const dietTotal = a.diet_split.VEG + a.diet_split.EGG + a.diet_split.NON_VEG;
  ok('the veg/egg/non-veg split covers every dish', dietTotal === a.summary.items,
     `${dietTotal} vs ${a.summary.items}`);

  ok('top sellers are ranked, highest first',
     a.top_items.every((x, i, arr) => i === 0 || arr[i - 1].qty >= x.qty));
  ok('at most ten are listed', a.top_items.length <= 10);
  ok('average order value is revenue over orders',
     a.summary.orders === 0 ||
     Math.abs(a.summary.avg_order_value - a.summary.revenue / a.summary.orders) < 0.01);

  if (a.summary.orders > 0) {
    const busiest = a.by_hour.reduce((b, h) => (h.orders > b.orders ? h : b), a.by_hour[0]);
    ok('the busiest hour really is the busiest', a.summary.busiest_hour === busiest.hour,
       `${a.summary.busiest_hour}:00 with ${a.summary.busiest_hour_orders}`);
  }

  console.log('\n-- cancelled orders must not reach the books');
  const pts = (await (await fetch(BASE + '/api/admin/service-points', { headers: { Cookie: mgr } })).json()).service_points;
  const items = (await (await fetch(BASE + '/api/menu')).json()).categories.flatMap((c) => c.items);
  const before = analytics.getAnalytics({ days: 1 }).summary;
  const o = (await (await fetch(BASE + '/api/orders', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_order_id: 'an-' + Date.now(), qr_slug: pts[0].qr_slug,
      items: [{ menu_item_id: items[0].id, quantity: 3 }] }) })).json()).order;
  const mid = analytics.getAnalytics({ days: 1 }).summary;
  ok('a live order counts', mid.orders === before.orders + 1);
  await fetch(`${BASE}/api/orders/${o.id}/status`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: kit }, body: JSON.stringify({ status: 'CANCELLED' }) });
  const after = analytics.getAnalytics({ days: 1 }).summary;
  ok('a voided order is removed from the count', after.orders === before.orders);
  ok('a voided order is removed from takings', Math.abs(after.revenue - before.revenue) < 0.01);

  console.log('\n-- the books survive a menu edit');
  const snapshotRevenue = analytics.getAnalytics({ days: 30 }).summary.revenue;
  const target = items[0];
  await fetch(`${BASE}/api/admin/menu-items/${target.id}`, { method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: mgr },
    body: JSON.stringify({ ...target, price: target.price + 500 }) });
  const afterEdit = analytics.getAnalytics({ days: 30 }).summary.revenue;
  ok('changing a price today does not change last week\'s takings',
     Math.abs(afterEdit - snapshotRevenue) < 0.01,
     `₹${Math.round(snapshotRevenue)} before, ₹${Math.round(afterEdit)} after`);
  await fetch(`${BASE}/api/admin/menu-items/${target.id}`, { method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: mgr },
    body: JSON.stringify({ ...target, price: target.price }) });

  console.log('\n-- range limits');
  const big = await (await fetch(BASE + '/api/admin/analytics?days=9999', { headers: { Cookie: mgr } })).json();
  ok('an absurd range is clamped', big.range.days === 90, `asked 9999, got ${big.range.days}`);
  const zero = await (await fetch(BASE + '/api/admin/analytics?days=0', { headers: { Cookie: mgr } })).json();
  ok('a zero range falls back to something sane', zero.range.days >= 1);

  console.log(`\n=== ${pass} passed, ${fail} failed ===\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CRASHED:', e); process.exit(1); });
