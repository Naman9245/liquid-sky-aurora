'use strict';

const { db } = require('../db');
const menuService = require('./menuService');
const { ValidationError } = menuService;
const config = require('../config');

const ACTIVE_STATUSES = ['PLACED', 'PREPARING', 'READY'];

// Forward transitions, plus two deliberate corrections: a mis-tapped READY can
// go back to PREPARING, and anything not yet served can be cancelled.
const ALLOWED_TRANSITIONS = {
  PLACED:    ['PREPARING', 'READY', 'CANCELLED'],
  PREPARING: ['READY', 'PLACED', 'CANCELLED'],
  READY:     ['SERVED', 'PREPARING', 'CANCELLED'],
  SERVED:    [],
  CANCELLED: [],
};

/* ------------------------------------------------------------------ reads */

const selectOrder = db.prepare(`
  SELECT o.*, sp.label AS service_point_label, sp.kind AS service_point_kind, sp.zone
  FROM orders o
  JOIN service_points sp ON sp.id = o.service_point_id
  WHERE o.id = ?
`);

const selectOrderItems = db.prepare(
  'SELECT * FROM order_items WHERE order_id = ? ORDER BY id'
);

function getOrder(id) {
  const order = selectOrder.get(id);
  if (!order) return null;
  return shapeOrder(order, selectOrderItems.all(id));
}

function shapeOrder(order, items) {
  const total = items.reduce((sum, i) => sum + i.price_snapshot * i.quantity, 0);
  return {
    id: order.id,
    client_order_id: order.client_order_id,
    service_point: {
      id: order.service_point_id,
      label: order.service_point_label,
      kind: order.service_point_kind,
      zone: order.zone,
    },
    status: order.status,
    order_type: order.order_type,
    server_name: order.server_name,
    notes: order.notes,
    placed_at: order.placed_at,
    ready_at: order.ready_at,
    served_at: order.served_at,
    // Longest prep time across the order — the number the customer actually cares
    // about, since the table is served when the slowest station finishes.
    eta_minutes: items.reduce((max, i) => Math.max(max, i.prep_minutes), 0),
    total,
    // What the diner will actually be charged once tax is added. Computed, not
    // stored — the invoice is the record, this is only a preview.
    tax_preview: config.GST.enabled ? (() => {
      const gst = require('./gstService');
      const t = gst.computeTax(
        items.map((i) => ({ name: i.name_snapshot, price: i.price_snapshot, quantity: i.quantity })),
        { rate: config.GST.rate, pricesIncludeTax: config.GST.pricesIncludeTax },
      );
      return {
        taxable_value: t.taxable_value, cgst_rate: t.cgst_rate, cgst_amount: t.cgst_amount,
        sgst_rate: t.sgst_rate, sgst_amount: t.sgst_amount,
        round_off: t.round_off, payable: t.total,
      };
    })() : null,
    items: items.map((i) => ({
      id: i.id,
      menu_item_id: i.menu_item_id,
      name: i.name_snapshot,
      price: i.price_snapshot,
      station: i.station,
      diet_type: i.diet_snapshot,
      prep_minutes: i.prep_minutes,
      quantity: i.quantity,
      special_notes: i.special_notes,
      item_status: i.item_status,
      line_total: i.price_snapshot * i.quantity,
    })),
  };
}

const orderSlugMatch = db.prepare(`
  SELECT 1 FROM orders o
  JOIN service_points sp ON sp.id = o.service_point_id
  WHERE o.id = ? AND sp.qr_slug = ?
`);

/** True when this order was placed from that table's QR code. */
function orderBelongsToSlug(orderId, slug) {
  return !!orderSlugMatch.get(orderId, slug);
}

const selectActiveIds = db.prepare(`
  SELECT id FROM orders
  WHERE status IN ('PLACED','PREPARING','READY')
  ORDER BY placed_at DESC
`);

function getActiveOrders() {
  return selectActiveIds.all().map((r) => getOrder(r.id));
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

const selectTodayIds = db.prepare(
  'SELECT id FROM orders WHERE placed_at >= ? ORDER BY placed_at DESC'
);

function getTodayOrders() {
  return selectTodayIds.all(startOfToday()).map((r) => getOrder(r.id));
}

function getTodayStats() {
  const orders = getTodayOrders();
  const billable = orders.filter((o) => o.status !== 'CANCELLED');
  const itemsSold = billable.reduce(
    (sum, o) => sum + o.items.reduce((s, i) => s + i.quantity, 0), 0
  );
  const revenue = billable.reduce((sum, o) => sum + o.total, 0);

  const tally = new Map();
  for (const order of billable) {
    for (const item of order.items) {
      tally.set(item.name, (tally.get(item.name) || 0) + item.quantity);
    }
  }
  const topItems = [...tally.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, qty]) => ({ name, qty }));

  return {
    order_count: billable.length,
    cancelled_count: orders.length - billable.length,
    items_sold: itemsSold,
    revenue,
    active_count: billable.filter((o) => ACTIVE_STATUSES.includes(o.status)).length,
    top_items: topItems,
  };
}

/* ----------------------------------------------------------------- writes */

const findByClientId = db.prepare('SELECT id FROM orders WHERE client_order_id = ?');
const findServicePoint = db.prepare(
  'SELECT * FROM service_points WHERE qr_slug = ? AND is_active = 1'
);
const findMenuItem = db.prepare('SELECT * FROM menu_items WHERE id = ?');

const insertOrder = db.prepare(`
  INSERT INTO orders (service_point_id, client_order_id, status, order_type, notes, placed_at)
  VALUES (@service_point_id, @client_order_id, 'PLACED', @order_type, @notes, @placed_at)
`);

const insertOrderItem = db.prepare(`
  INSERT INTO order_items
    (order_id, menu_item_id, name_snapshot, price_snapshot, station, diet_snapshot,
     prep_minutes, quantity, special_notes)
  VALUES
    (@order_id, @menu_item_id, @name_snapshot, @price_snapshot, @station, @diet_snapshot,
     @prep_minutes, @quantity, @special_notes)
`);

const insertEvent = db.prepare(`
  INSERT INTO event_log (type, order_id, payload, created_at)
  VALUES (?, ?, ?, ?)
`);

/**
 * Defect 03: on weak highway 4G a customer taps Place Order, sees nothing, and
 * taps again. The client mints one UUID per attempt; a repeat returns the order
 * that already exists rather than creating a second one.
 */
function placeOrder(input) {
  const clientOrderId = String(input?.client_order_id || '').trim();
  if (!clientOrderId) throw new ValidationError('client_order_id is required');

  const existing = findByClientId.get(clientOrderId);
  if (existing) return { order: getOrder(existing.id), duplicate: true, event: null };

  const servicePoint = findServicePoint.get(String(input?.qr_slug || '').trim());
  if (!servicePoint) throw new ValidationError('That QR code is not valid. Please ask a member of staff.');

  const lines = Array.isArray(input?.items) ? input.items : [];
  if (lines.length === 0) throw new ValidationError('Your order is empty');

  // Resolve and snapshot every line before opening the transaction, so a bad
  // item never leaves a half-written order behind.
  const servingWindows = menuService.selectWindows.all();
  const resolved = lines.map((line) => {
    const item = findMenuItem.get(Number(line.menu_item_id));
    if (!item) throw new ValidationError('One of those dishes is no longer on the menu');
    if (!item.is_available) throw new ValidationError(`${item.name} has just run out — please remove it and try again`);
    // A tab left open since breakfast must not be able to order dosa at 22:30.
    if (!menuService.servableNow(item.id, servingWindows)) {
      throw new ValidationError(`${item.name} is not served at this time of day — please remove it`);
    }

    const quantity = Math.round(Number(line.quantity));
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 50) {
      throw new ValidationError(`Quantity for ${item.name} must be between 1 and 50`);
    }
    return {
      menu_item_id: item.id,
      name_snapshot: item.name,      // Defect 02: history must not move when the menu is edited
      price_snapshot: item.price,
      station: item.station,
      diet_snapshot: item.diet_type,   // veg/non-veg is safety-critical: never re-derive it
      prep_minutes: item.prep_minutes,
      quantity,
      special_notes: line.special_notes ? String(line.special_notes).trim().slice(0, 200) : null,
    };
  });

  const orderType = ['DINE_IN', 'ROOM_SERVICE', 'DRIVE_THRU', 'TAKEAWAY'].includes(input.order_type)
    ? input.order_type
    : servicePointDefaultType(servicePoint.kind);

  const now = Date.now();

  const run = db.transaction(() => {
    const info = insertOrder.run({
      service_point_id: servicePoint.id,
      client_order_id: clientOrderId,
      order_type: orderType,
      notes: input.notes ? String(input.notes).trim().slice(0, 300) : null,
      placed_at: now,
    });
    const orderId = Number(info.lastInsertRowid);
    for (const line of resolved) insertOrderItem.run({ ...line, order_id: orderId });
    return orderId;
  });

  let orderId;
  try {
    orderId = run();
  } catch (err) {
    // Two taps landing at the same instant lose the race on the UNIQUE index.
    if (String(err.message).includes('UNIQUE') && String(err.message).includes('client_order_id')) {
      const raced = findByClientId.get(clientOrderId);
      if (raced) return { order: getOrder(raced.id), duplicate: true, event: null };
    }
    throw err;
  }

  const order = getOrder(orderId);
  const event = logEvent('new_order', orderId, { order });
  return { order, duplicate: false, event };
}

function servicePointDefaultType(kind) {
  if (kind === 'ROOM') return 'ROOM_SERVICE';
  if (kind === 'DRIVE_THRU') return 'DRIVE_THRU';
  if (kind === 'COUNTER') return 'TAKEAWAY';
  return 'DINE_IN';
}

const updateOrderRow = db.prepare(`
  UPDATE orders SET status = @status, ready_at = @ready_at, served_at = @served_at,
                    server_name = @server_name
  WHERE id = @id
`);
const updateAllItems = db.prepare(
  'UPDATE order_items SET item_status = ? WHERE order_id = ?'
);
const updateOneItem = db.prepare(
  'UPDATE order_items SET item_status = ? WHERE id = ? AND order_id = ?'
);

/**
 * Phase 0 drives status from the order card. Phase 1 adds per-station screens
 * that set item_status individually, at which point deriveStatus() below takes
 * over — the order is only READY when every station has finished.
 */
function updateOrderStatus(orderId, nextStatus, staff = null) {
  const order = getOrder(orderId);
  if (!order) throw new ValidationError('That order no longer exists');

  const allowed = ALLOWED_TRANSITIONS[order.status] || [];
  if (!allowed.includes(nextStatus)) {
    throw new ValidationError(`An order that is ${order.status} cannot become ${nextStatus}`);
  }

  const now = Date.now();
  const run = db.transaction(() => {
    updateOrderRow.run({
      id: orderId,
      status: nextStatus,
      ready_at: nextStatus === 'READY' ? (order.ready_at || now) : order.ready_at,
      served_at: nextStatus === 'SERVED' ? now : order.served_at,
      // Whoever carried it to the table gets the credit on the receipt.
      server_name: nextStatus === 'SERVED' && staff ? staff.name : order.server_name,
    });
    if (nextStatus !== 'CANCELLED') {
      updateAllItems.run(itemStatusFor(nextStatus), orderId);
    }
  });
  run();

  const updated = getOrder(orderId);
  const event = logEvent('order_status_changed', orderId, { order: updated });
  return { order: updated, event };
}

function itemStatusFor(orderStatus) {
  return orderStatus === 'PLACED' ? 'QUEUED' : orderStatus;
}

/** Used by the Phase 1 per-station screens; the derived status is the point. */
function updateItemStatus(orderId, orderItemId, nextStatus, staff = null) {
  const order = getOrder(orderId);
  if (!order) throw new ValidationError('That order no longer exists');
  if (!['QUEUED', 'PREPARING', 'READY', 'SERVED'].includes(nextStatus)) {
    throw new ValidationError('Unknown item status');
  }

  const now = Date.now();
  const run = db.transaction(() => {
    const changed = updateOneItem.run(nextStatus, orderItemId, orderId).changes;
    if (!changed) throw new ValidationError('That item is not part of this order');

    const items = selectOrderItems.all(orderId);
    const derived = deriveStatus(items);
    updateOrderRow.run({
      id: orderId,
      status: derived,
      ready_at: derived === 'READY' ? (order.ready_at || now) : order.ready_at,
      served_at: derived === 'SERVED' ? (order.served_at || now) : order.served_at,
      server_name: derived === 'SERVED' && staff ? (order.server_name || staff.name) : order.server_name,
    });
  });
  run();

  const updated = getOrder(orderId);
  const event = logEvent('order_status_changed', orderId, { order: updated });
  return { order: updated, event };
}

/**
 * A station only ever writes item_status. The order's own status is computed
 * from its items — so the wok finishing early can never tell a table their
 * tandoor order is ready.
 */
function deriveStatus(items) {
  if (items.length === 0) return 'PLACED';
  if (items.every((i) => i.item_status === 'SERVED')) return 'SERVED';
  if (items.every((i) => i.item_status === 'READY' || i.item_status === 'SERVED')) return 'READY';
  if (items.some((i) => i.item_status !== 'QUEUED')) return 'PREPARING';
  return 'PLACED';
}

/* -------------------------------------------------- event log / replay */

/**
 * Defect 04: Socket.io reconnects but replays nothing. Every broadcast is
 * written here first, so a kitchen tablet that dropped wifi can ask for the gap.
 */
function logEvent(type, orderId, payload) {
  const createdAt = Date.now();
  const info = insertEvent.run(type, orderId, JSON.stringify(payload), createdAt);
  return { id: Number(info.lastInsertRowid), type, order_id: orderId, payload, created_at: createdAt };
}

const REPLAY_PAGE_SIZE = 500;
const selectEventsSince = db.prepare(
  `SELECT * FROM event_log WHERE id > ? ORDER BY id LIMIT ${REPLAY_PAGE_SIZE}`
);
const selectLatestEventId = db.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM event_log');

function getEventsSince(lastSeq) {
  const since = Number.isFinite(Number(lastSeq)) ? Number(lastSeq) : 0;
  return selectEventsSince.all(since).map((row) => ({
    id: row.id,
    type: row.type,
    order_id: row.order_id,
    payload: JSON.parse(row.payload),
    created_at: row.created_at,
  }));
}

function getLatestEventId() {
  return selectLatestEventId.get().id;
}

module.exports = {
  getOrder, getActiveOrders, getTodayOrders, getTodayStats, orderBelongsToSlug,
  placeOrder, updateOrderStatus, updateItemStatus, deriveStatus,
  logEvent, getEventsSince, getLatestEventId, REPLAY_PAGE_SIZE,
  ACTIVE_STATUSES, ALLOWED_TRANSITIONS,
};
