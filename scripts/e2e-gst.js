/* Phase 3 — GST tax invoicing. Runs with GST on or off. */
const BASE = process.env.BASE || 'http://localhost:3000';
const gst = require('../server/services/gstService');
const config = require('../server/config');
const auth = require('../server/services/authService');
const { db } = require('../server/db');

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? '  PASS' : '! FAIL'}  ${n}${x ? '  — ' + x : ''}`); };
const near = (a, b) => Math.abs(a - b) < 0.005;

(async () => {
  console.log('\n=== GST tax invoicing ===\n');
  console.log(`  GST configured: ${config.GST.enabled ? 'yes' : 'no'} · rate ${config.GST.rate}% · prices ${config.GST.pricesIncludeTax ? 'include' : 'exclude'} tax\n`);

  /* ---------------------------------------------------- the arithmetic */
  console.log('-- the arithmetic (independent of configuration)');
  const ex = (items, rate = 5) => gst.computeTax(items, { rate, pricesIncludeTax: false });
  const inc = (items, rate = 5) => gst.computeTax(items, { rate, pricesIncludeTax: true });
  const two = [{ name: 'Chicken Dum Biriyani', price: 280, quantity: 2 }];

  let t = ex(two);
  ok('tax added on top leaves the menu price as the taxable value', near(t.taxable_value, 560));
  ok('5% splits into 2.5% CGST and 2.5% SGST', t.cgst_rate === 2.5 && t.sgst_rate === 2.5);
  ok('the two halves are ₹14 each', near(t.cgst_amount, 14) && near(t.sgst_amount, 14));
  ok('the total is ₹588', near(t.total, 588), `₹${t.total}`);

  t = inc(two);
  ok('tax included leaves the diner paying the menu price', near(t.total, 560), `₹${t.total}`);
  ok('the taxable value is worked back out', near(t.taxable_value, 533.33), `₹${t.taxable_value}`);
  ok('the tax still adds to the difference', near(t.cgst_amount + t.sgst_amount, 26.67));

  console.log('\n-- rounding, where money usually goes wrong');
  t = ex([{ name: 'Idly', price: 90, quantity: 1 }]);
  ok('₹94.50 rounds to ₹95', near(t.total, 95) && near(t.round_off, 0.5), `round off ₹${t.round_off}`);
  t = ex([{ name: 'X', price: 77, quantity: 3 }]);
  ok('an odd tax splits without losing a paisa',
     near(t.cgst_amount + t.sgst_amount, 11.55), `${t.cgst_amount} + ${t.sgst_amount}`);
  ok('and still totals ₹243', near(t.total, 243));

  console.log('\n-- every invoice must add up');
  const cases = [
    [[{ name: 'a', price: 7, quantity: 1 }], 5],
    [[{ name: 'a', price: 999, quantity: 7 }], 5],
    [[{ name: 'a', price: 33.33, quantity: 3 }], 18],
    [[{ name: 'a', price: 1, quantity: 1 }], 18],
    [[{ name: 'a', price: 280, quantity: 2 }, { name: 'b', price: 90, quantity: 1 }], 5],
  ];
  let allAddUp = true;
  for (const [items, rate] of cases) {
    for (const incl of [false, true]) {
      const r = gst.computeTax(items, { rate, pricesIncludeTax: incl });
      if (!near(r.taxable_value + r.cgst_amount + r.sgst_amount + r.round_off, r.total)) allAddUp = false;
      if (!near(r.total, Math.round(r.total))) allAddUp = false;   // must land on a whole rupee
    }
  }
  ok('taxable + CGST + SGST + round off = total, in every case', allAddUp, `${cases.length * 2} combinations`);

  console.log('\n-- the financial year runs April to March');
  ok('1 April 2026 is 26-27', gst.financialYear(new Date(2026, 3, 1).getTime()) === '26-27');
  ok('31 March 2026 is still 25-26', gst.financialYear(new Date(2026, 2, 31).getTime()) === '25-26');
  ok('1 January 2026 is 25-26', gst.financialYear(new Date(2026, 0, 1).getTime()) === '25-26');

  console.log('\n-- the invoice number');
  const no = gst.formatNumber('HH', '25-26', 42);
  ok('reads HH/25-26/000042', no === 'HH/25-26/000042', no);
  ok('fits the 16-character limit in Rule 46', no.length <= 16, `${no.length} characters`);

  /* -------------------------------------------------------- live path */
  const e = auth.listStaff().find((s) => s.name === 'GST Mgr')
    || auth.createStaff({ name: 'GST Mgr', role: 'MANAGER', pin: '616161' });
  auth.changePin(e.id, '616161');
  const r = await fetch(BASE + '/api/auth/login', { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: '616161' }) });
  const mgr = (r.headers.get('set-cookie') || '').split(';')[0];
  const H = { 'Content-Type': 'application/json', Cookie: mgr };

  const pts = (await (await fetch(BASE + '/api/admin/service-points', { headers: H })).json()).service_points;
  const items = (await (await fetch(BASE + '/api/menu')).json()).categories.flatMap((c) => c.items);
  const biry = items.find((i) => i.name === 'Chicken Dum Biriyani');
  const mkOrder = async () => (await (await fetch(BASE + '/api/orders', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_order_id: 'gst-' + Date.now() + '-' + Math.random(),
      qr_slug: pts[0].qr_slug, items: [{ menu_item_id: biry.id, quantity: 2 }] }) })).json()).order;

  if (!config.GST.enabled) {
    console.log('\n-- with no GSTIN, nothing pretends to be a tax invoice');
    const o = await mkOrder();
    const bill = await (await fetch(`${BASE}/api/print/bill/${o.id}`, { headers: H })).text();
    ok('the bill says it is not a tax invoice', bill.includes('not a tax invoice'));
    ok('it shows no GSTIN', !bill.includes('GSTIN'));
    ok('no invoice was issued', gst.getForOrder(o.id) === null);
    ok('the order carries no tax preview', o.tax_preview === null);
    const s = await (await fetch(BASE + '/api/admin/gst', { headers: H })).json();
    ok('the filing summary says so plainly', s.enabled === false, s.reason);
    const cfg = await (await fetch(BASE + '/api/config')).json();
    ok('the phone is told GST is off', cfg.gst_enabled === false);
  } else {
    console.log('\n-- a real invoice');
    const o = await mkOrder();
    ok('the order carries a tax preview', !!o.tax_preview);
    const bill = await (await fetch(`${BASE}/api/print/bill/${o.id}`, { headers: H })).text();
    const inv = gst.getForOrder(o.id);
    ok('an invoice was issued', !!inv, inv && inv.invoice_no);
    ok('the bill is headed TAX INVOICE', bill.includes('TAX INVOICE'));
    ok('it shows the GSTIN', bill.includes(config.GST.gstin));
    ok('it shows the invoice number', inv && bill.includes(inv.invoice_no));
    ok('it shows CGST and SGST separately', bill.includes('CGST') && bill.includes('SGST'));
    ok('it shows the SAC code', bill.includes(gst.SAC_RESTAURANT));
    ok('it no longer disclaims being a tax invoice', !bill.includes('not a tax invoice'));
    // CGST on a ₹770 bill is ₹19.25. Printing ₹19 understates the tax.
    ok('tax figures are shown to the paisa',
       new RegExp('CGST[^₹]*₹[0-9,]+\\.[0-9]{2}').test(bill)
       && new RegExp('Taxable value[^₹]*₹[0-9,]+\\.[0-9]{2}').test(bill),
       (bill.match(/CGST[^₹]*₹[0-9,.]+/) || [])[0]);

    console.log('\n-- the number is allocated once and never again');
    await fetch(`${BASE}/api/print/bill/${o.id}`, { headers: H });
    await fetch(`${BASE}/api/print/bill/${o.id}`, { headers: H });
    const again = gst.getForOrder(o.id);
    ok('reprinting does not renumber', again.invoice_no === inv.invoice_no, inv.invoice_no);
    ok('only one invoice row exists for the order',
       db.prepare('SELECT COUNT(*) n FROM invoices WHERE order_id = ?').get(o.id).n === 1);

    console.log('\n-- the series is consecutive');
    const before = inv.serial;
    const o2 = await mkOrder();
    await fetch(`${BASE}/api/print/bill/${o2.id}`, { headers: H });
    const inv2 = gst.getForOrder(o2.id);
    ok('the next invoice is the next number', inv2.serial === before + 1,
       `${inv.invoice_no} then ${inv2.invoice_no}`);
    ok('both are in the same financial year', inv2.financial_year === inv.financial_year);

    console.log('\n-- what the diner is charged');
    ok('the invoice total matches the tax preview', near(inv.total, o.tax_preview.payable),
       `₹${inv.total}`);
    ok('the invoice total is more than the menu adds up to', inv.total > o.total,
       `menu ₹${o.total}, payable ₹${inv.total}`);
    const link = await (await fetch(`${BASE}/api/orders/${o.id}/upi-link?slug=${pts[0].qr_slug}`)).json();
    if (link.link) {
      ok('the UPI request asks for the taxed amount, not the menu total',
         link.link.includes(`am=${inv.total.toFixed(2)}`), `asked ₹${link.amount}`);
    } else {
      ok('UPI is off, so nothing to check there', true);
    }

    console.log('\n-- a voided order gets no invoice');
    const o3 = await mkOrder();
    await fetch(`${BASE}/api/orders/${o3.id}/status`, { method: 'POST', headers: H,
      body: JSON.stringify({ status: 'CANCELLED' }) });
    const refused = await fetch(`${BASE}/api/print/bill/${o3.id}`, { headers: H });
    ok('billing a voided order is refused', refused.status === 409, `HTTP ${refused.status}`);
    ok('and no number was burned on it', gst.getForOrder(o3.id) === null);

    console.log('\n-- the filing summary');
    const s = await (await fetch(BASE + '/api/admin/gst?days=30', { headers: H })).json();
    ok('it is enabled', s.enabled === true);
    ok('it counts the invoices', s.count >= 2, `${s.count} in 30 days`);
    ok('the tax totals add up',
       near(s.taxable_value + s.cgst_amount + s.sgst_amount + s.round_off, s.total),
       `₹${s.total.toFixed(2)}`);
    ok('CGST and SGST are equal, as they must be for a local sale',
       Math.abs(s.cgst_amount - s.sgst_amount) < 1);
    ok('it reports no gaps in the series', s.series_gaps.length === 0,
       s.series_gaps.length ? JSON.stringify(s.series_gaps) : 'consecutive');
    ok('it names the first and last invoice', !!s.first && !!s.last, `${s.first} … ${s.last}`);

    console.log('\n-- the invoice is frozen once issued');
    const target = items.find((i) => i.name === 'Chicken Dum Biriyani');
    await fetch(`${BASE}/api/admin/menu-items/${target.id}`, { method: 'PUT', headers: H,
      body: JSON.stringify({ ...target, price: target.price + 100 }) });
    const after = gst.getForOrder(o.id);
    ok('changing the price today does not alter an issued invoice',
       near(after.total, inv.total) && near(after.taxable_value, inv.taxable_value),
       `still ₹${after.total}`);
    await fetch(`${BASE}/api/admin/menu-items/${target.id}`, { method: 'PUT', headers: H,
      body: JSON.stringify({ ...target, price: target.price }) });
  }

  console.log('\n-- only a manager sees the tax records');
  ok('an anonymous caller cannot', (await fetch(BASE + '/api/admin/gst')).status === 401);

  console.log(`\n=== ${pass} passed, ${fail} failed ===\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CRASHED:', e); process.exit(1); });
