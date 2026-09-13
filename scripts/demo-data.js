#!/usr/bin/env node
'use strict';

/**
 * Generates a week of plausible orders so the Insights screen has something to
 * show before the restaurant has traded on it. DEMO DATA ONLY — never run this
 * against a database that holds real orders.
 *
 *   node scripts/demo-data.js          7 days
 *   node scripts/demo-data.js 30       30 days
 */

const { db } = require('../server/db');
const menu = require('../server/services/menuService');
const points = require('../server/services/servicePointService');

const days = Math.min(60, Math.max(1, Number(process.argv[2]) || 7));

const existing = db.prepare("SELECT COUNT(*) n FROM orders WHERE client_order_id NOT LIKE 'demo-%'").get().n;
if (existing > 0) {
  console.error(`\n  Refusing to run: this database already holds ${existing} real order(s).`);
  console.error('  Demo data is for an empty system only.\n');
  process.exit(1);
}

const items = menu.getMenu({ onlyAvailable: true }).flatMap((c) => c.items);
const sps = points.list().filter((p) => p.is_active);
if (!items.length || !sps.length) {
  console.error('\n  Run "npm run seed" first.\n');
  process.exit(1);
}

// Two peaks, a quiet small-hours trough, and a highway bump overnight — which is
// what a 24-hour restaurant beside an airport road actually looks like.
const HOUR_WEIGHT = [
  3, 2, 2, 1, 1, 2, 4, 7, 9, 8, 6, 7,     // 00–11
  14, 16, 11, 6, 5, 6, 9, 15, 18, 14, 9, 5, // 12–23
];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const weightedHour = () => {
  const total = HOUR_WEIGHT.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let h = 0; h < 24; h++) { r -= HOUR_WEIGHT[h]; if (r <= 0) return h; }
  return 12;
};

const insertOrder = db.prepare(`
  INSERT INTO orders (service_point_id, client_order_id, status, order_type, server_name,
                      notes, placed_at, ready_at, served_at)
  VALUES (@sp, @cid, 'SERVED', @type, @server, NULL, @placed, @ready, @served)
`);
const insertItem = db.prepare(`
  INSERT INTO order_items (order_id, menu_item_id, name_snapshot, price_snapshot, station,
                           diet_snapshot, prep_minutes, quantity, special_notes, item_status)
  VALUES (@order, @item, @name, @price, @station, @diet, @prep, @qty, NULL, 'SERVED')
`);

const SERVERS = ['Deva', 'Sahil Khan', 'Rohan', 'Manager'];
const typeFor = (kind) => ({ ROOM: 'ROOM_SERVICE', DRIVE_THRU: 'DRIVE_THRU', COUNTER: 'TAKEAWAY' }[kind] || 'DINE_IN');

let orderCount = 0, itemCount = 0, revenue = 0;

const run = db.transaction(() => {
  for (let d = days - 1; d >= 0; d--) {
    const base = new Date();
    base.setHours(0, 0, 0, 0);
    base.setDate(base.getDate() - d);
    const isWeekend = [0, 6].includes(base.getDay());
    const todays = Math.round((isWeekend ? 46 : 32) * (0.8 + Math.random() * 0.4));

    for (let n = 0; n < todays; n++) {
      const hour = weightedHour();
      const placed = base.getTime() + hour * 3600000 + Math.floor(Math.random() * 3600000);
      if (placed > Date.now()) continue;

      const sp = pick(sps);
      const lines = Array.from({ length: 1 + Math.floor(Math.random() * 4) }, () => pick(items));
      const uniq = [...new Map(lines.map((i) => [i.id, i])).values()];
      const eta = Math.max(...uniq.map((i) => i.prep_minutes));
      const ready = placed + (eta + Math.floor(Math.random() * 8) - 2) * 60000;

      const info = insertOrder.run({
        sp: sp.id, cid: `demo-${placed}-${n}`, type: typeFor(sp.kind),
        server: pick(SERVERS), placed, ready, served: ready + 3 * 60000,
      });
      const orderId = Number(info.lastInsertRowid);
      orderCount++;

      for (const it of uniq) {
        const qty = 1 + (Math.random() < 0.25 ? 1 : 0);
        insertItem.run({
          order: orderId, item: it.id, name: it.name, price: it.price,
          station: it.station, diet: it.diet_type, prep: it.prep_minutes, qty,
        });
        itemCount += qty;
        revenue += it.price * qty;
      }
    }
  }
});
run();

console.log(`\n  Demo data: ${orderCount} orders, ${itemCount} items, ₹${revenue.toLocaleString('en-IN')} across ${days} days.`);
console.log('  Clear it with: npm run reseed\n');
