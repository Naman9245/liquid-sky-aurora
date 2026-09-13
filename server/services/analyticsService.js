'use strict';

const { db } = require('../db');

/**
 * Everything the owner can learn from orders already taken. All of it derives
 * from order_items' snapshots, never from the live menu — so a price change or a
 * deleted dish cannot rewrite last week's numbers.
 */

function startOfDay(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function dayRange(days) {
  const to = Date.now();
  const from = startOfDay(to) - (Math.max(1, days) - 1) * 86400000;
  return { from, to };
}

const selectOrders = db.prepare(`
  SELECT o.id, o.placed_at, o.ready_at, o.served_at, o.status, o.order_type,
         o.server_name, sp.label AS point_label, sp.kind AS point_kind
  FROM orders o
  JOIN service_points sp ON sp.id = o.service_point_id
  WHERE o.placed_at >= ? AND o.placed_at <= ? AND o.status != 'CANCELLED'
  ORDER BY o.placed_at
`);

const selectItems = db.prepare(`
  SELECT oi.order_id, oi.name_snapshot AS name, oi.price_snapshot AS price,
         oi.quantity, oi.station, oi.diet_snapshot AS diet,
         o.placed_at,
         COALESCE(c.name, 'Uncategorised') AS category
  FROM order_items oi
  JOIN orders o ON o.id = oi.order_id
  LEFT JOIN menu_items mi ON mi.id = oi.menu_item_id
  LEFT JOIN menu_categories c ON c.id = mi.category_id
  WHERE o.placed_at >= ? AND o.placed_at <= ? AND o.status != 'CANCELLED'
`);

function tally(rows, keyFn, valueFn) {
  const map = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    if (k == null) continue;
    const prev = map.get(k) || { qty: 0, revenue: 0, orders: new Set() };
    const v = valueFn(r);
    prev.qty += v.qty;
    prev.revenue += v.revenue;
    if (v.orderId != null) prev.orders.add(v.orderId);
    map.set(k, prev);
  }
  return map;
}

function getAnalytics({ days = 7 } = {}) {
  const { from, to } = dayRange(days);
  const orders = selectOrders.all(from, to);
  const items = selectItems.all(from, to);

  const revenue = items.reduce((s, i) => s + i.price * i.quantity, 0);
  const itemCount = items.reduce((s, i) => s + i.quantity, 0);

  /* ---------------------------------------------------------- by hour */
  // The restaurant runs 24 hours, so all 24 buckets are real, not padding.
  const byHour = Array.from({ length: 24 }, (_, hour) => ({
    hour, orders: 0, items: 0, revenue: 0,
  }));
  for (const o of orders) byHour[new Date(o.placed_at).getHours()].orders += 1;
  for (const i of items) {
    const h = new Date(i.placed_at).getHours();
    byHour[h].items += i.quantity;
    byHour[h].revenue += i.price * i.quantity;
  }

  /* ----------------------------------------------------------- by day */
  const byDay = [];
  for (let t = startOfDay(from); t <= to; t += 86400000) {
    const next = t + 86400000;
    const dayOrders = orders.filter((o) => o.placed_at >= t && o.placed_at < next);
    const ids = new Set(dayOrders.map((o) => o.id));
    const dayRevenue = items
      .filter((i) => ids.has(i.order_id))
      .reduce((s, i) => s + i.price * i.quantity, 0);
    byDay.push({
      date: t,
      label: new Date(t).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }),
      weekday: new Date(t).toLocaleDateString('en-IN', { weekday: 'short' }),
      orders: dayOrders.length,
      revenue: dayRevenue,
    });
  }

  /* ------------------------------------------------------- top sellers */
  const itemTally = tally(items, (i) => i.name,
    (i) => ({ qty: i.quantity, revenue: i.price * i.quantity }));
  const topItems = [...itemTally.entries()]
    .map(([name, v]) => ({ name, qty: v.qty, revenue: v.revenue }))
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 10);
  const topByRevenue = [...itemTally.entries()]
    .map(([name, v]) => ({ name, qty: v.qty, revenue: v.revenue }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10);

  /* ---------------------------------------------------------- stations */
  const stationTally = tally(items, (i) => i.station,
    (i) => ({ qty: i.quantity, revenue: i.price * i.quantity }));
  const byStation = [...stationTally.entries()]
    .map(([station, v]) => ({
      station,
      items: v.qty,
      revenue: v.revenue,
      share: itemCount ? v.qty / itemCount : 0,
    }))
    .sort((a, b) => b.items - a.items);

  /* -------------------------------------------------------- categories */
  const catTally = tally(items, (i) => i.category,
    (i) => ({ qty: i.quantity, revenue: i.price * i.quantity }));
  const byCategory = [...catTally.entries()]
    .map(([name, v]) => ({ name, qty: v.qty, revenue: v.revenue }))
    .sort((a, b) => b.revenue - a.revenue);

  /* ----------------------------------------------------- service points */
  const pointOrders = new Map();
  for (const o of orders) {
    const prev = pointOrders.get(o.point_label) || { kind: o.point_kind, orders: 0, ids: new Set() };
    prev.orders += 1; prev.ids.add(o.id);
    pointOrders.set(o.point_label, prev);
  }
  const byServicePoint = [...pointOrders.entries()]
    .map(([label, v]) => ({
      label, kind: v.kind, orders: v.orders,
      revenue: items.filter((i) => v.ids.has(i.order_id))
        .reduce((s, i) => s + i.price * i.quantity, 0),
    }))
    .sort((a, b) => b.revenue - a.revenue);

  /* ------------------------------------------------------- order types */
  const typeTally = new Map();
  for (const o of orders) typeTally.set(o.order_type, (typeTally.get(o.order_type) || 0) + 1);
  const byOrderType = [...typeTally.entries()]
    .map(([type, n]) => ({ type, orders: n, share: orders.length ? n / orders.length : 0 }))
    .sort((a, b) => b.orders - a.orders);

  /* -------------------------------------------------------- diet split */
  const diet = { VEG: 0, EGG: 0, NON_VEG: 0 };
  for (const i of items) if (diet[i.diet] !== undefined) diet[i.diet] += i.quantity;

  /* ----------------------------------------------------------- service */
  const timed = orders.filter((o) => o.ready_at && o.ready_at > o.placed_at);
  const avgReady = timed.length
    ? timed.reduce((s, o) => s + (o.ready_at - o.placed_at), 0) / timed.length / 60000
    : null;

  const busiest = byHour.reduce((best, h) => (h.orders > best.orders ? h : best), byHour[0]);
  const busiestDay = byDay.reduce((best, d) => (d.orders > (best ? best.orders : -1) ? d : best), null);

  /* ------------------------------------------------------------ staff */
  const serverTally = new Map();
  for (const o of orders) {
    if (!o.server_name) continue;
    serverTally.set(o.server_name, (serverTally.get(o.server_name) || 0) + 1);
  }
  const byServer = [...serverTally.entries()]
    .map(([name, n]) => ({ name, orders: n }))
    .sort((a, b) => b.orders - a.orders);

  return {
    range: { days, from, to, has_data: orders.length > 0 },
    summary: {
      orders: orders.length,
      items: itemCount,
      revenue,
      avg_order_value: orders.length ? revenue / orders.length : 0,
      avg_minutes_to_ready: avgReady,
      busiest_hour: orders.length ? busiest.hour : null,
      busiest_hour_orders: orders.length ? busiest.orders : 0,
      busiest_day: busiestDay && busiestDay.orders ? busiestDay.label : null,
    },
    by_hour: byHour,
    by_day: byDay,
    top_items: topItems,
    top_by_revenue: topByRevenue,
    by_station: byStation,
    by_category: byCategory,
    by_service_point: byServicePoint,
    by_order_type: byOrderType,
    by_server: byServer,
    diet_split: diet,
  };
}

module.exports = { getAnalytics };
