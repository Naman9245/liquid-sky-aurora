'use strict';

const { EVENTS, ROOMS } = require('./events');
const orderService = require('../services/orderService');
const auth = require('../services/authService');

/**
 * Guarding the HTTP routes alone would be theatre: every write in this system
 * also has a socket path. The session cookie rides along in the handshake.
 */
function socketStaff(socket) {
  return auth.staffForToken(auth.readCookie(socket.handshake, auth.COOKIE));
}

function denyUnlessStaff(socket, ack, roles) {
  const staff = socketStaff(socket);
  if (!staff || (roles.length && !roles.includes(staff.role))) {
    if (typeof ack === 'function') ack({ ok: false, error: 'Please sign in', login_required: true });
    else socket.emit(EVENTS.ERROR, { message: 'Please sign in', login_required: true });
    return null;
  }
  return staff;
}

function attach(io) {
  io.on('connection', (socket) => {
    socket.on(EVENTS.JOIN_KITCHEN, (payload = {}, ack) => {
      const staff = denyUnlessStaff(socket, ack, ['KITCHEN', 'MANAGER']);
      if (!staff) return;
      socket.data.staff = staff;
      socket.join(ROOMS.kitchen);
      if (payload.station) socket.join(ROOMS.station(payload.station));
      replay(socket, payload.last_seq, ack, staff);
    });

    socket.on(EVENTS.JOIN_ADMIN, (payload = {}, ack) => {
      const staff = denyUnlessStaff(socket, ack, ['MANAGER']);
      if (!staff) return;
      socket.data.staff = staff;
      socket.join(ROOMS.admin);
      replay(socket, payload.last_seq, ack, staff);
    });

    // A customer joins only their own order's room. Without that scoping every
    // phone in the restaurant would receive every other table's order contents.
    socket.on(EVENTS.JOIN_ORDER, (payload = {}, ack) => {
      const orderId = Number(payload.order_id);
      if (!Number.isInteger(orderId)) return;

      const staff = socketStaff(socket);
      if (!staff && !orderService.orderBelongsToSlug(orderId, String(payload.qr_slug || ''))) {
        if (typeof ack === 'function') ack({ error: 'Order not found' });
        return;
      }

      socket.join(ROOMS.order(orderId));
      const order = orderService.getOrder(orderId);
      if (typeof ack === 'function') ack({ order, last_seq: orderService.getLatestEventId() });
    });

    socket.on(EVENTS.PLACE_ORDER, (payload = {}, ack) => {
      try {
        const result = orderService.placeOrder(payload);
        socket.join(ROOMS.order(result.order.id));
        if (!result.duplicate) broadcastNewOrder(io, result);
        if (typeof ack === 'function') {
          ack({ ok: true, order: result.order, duplicate: result.duplicate });
        }
      } catch (err) { fail(socket, ack, err); }
    });

    socket.on(EVENTS.UPDATE_ORDER_STATUS, (payload = {}, ack) => {
      const staff = denyUnlessStaff(socket, ack, ['KITCHEN', 'MANAGER']);
      if (!staff) return;
      try {
        const result = orderService.updateOrderStatus(Number(payload.order_id), payload.status, staff);
        broadcastStatusChange(io, result);
        if (typeof ack === 'function') ack({ ok: true, order: result.order });
      } catch (err) { fail(socket, ack, err); }
    });

    socket.on(EVENTS.UPDATE_ITEM_STATUS, (payload = {}, ack) => {
      const staff = denyUnlessStaff(socket, ack, ['KITCHEN', 'MANAGER']);
      if (!staff) return;
      try {
        const result = orderService.updateItemStatus(
          Number(payload.order_id), Number(payload.order_item_id), payload.status, staff
        );
        broadcastStatusChange(io, result);
        if (typeof ack === 'function') ack({ ok: true, order: result.order });
      } catch (err) { fail(socket, ack, err); }
    });

    // Defect 04: a tablet that dropped wifi asks for everything it missed.
    socket.on(EVENTS.SYNC_SINCE, (payload = {}, ack) => {
      const staff = denyUnlessStaff(socket, ack, ['KITCHEN', 'MANAGER']);
      if (!staff) return;
      replay(socket, payload.last_seq, ack, staff);
    });
  });
}

function replay(socket, lastSeq, ack, staff) {
  const events = orderService.getEventsSince(lastSeq);
  const latest = orderService.getLatestEventId();
  // getEventsSince() caps its page. If it truncated, the cursor must stay at the
  // last event we actually sent, or the next sync silently skips the remainder.
  const truncated = events.length === orderService.REPLAY_PAGE_SIZE && events.length > 0;
  const snapshot = {
    events,
    last_seq: truncated ? events[events.length - 1].id : latest,
    truncated,
    active_orders: orderService.getActiveOrders(),
    staff: staff || null,
  };
  if (typeof ack === 'function') ack(snapshot);
  else socket.emit(EVENTS.SYNC_REPLAY, snapshot);
}

function fail(socket, ack, err) {
  const message = err && err.name === 'ValidationError'
    ? err.message
    : 'Something went wrong at our end. Please try again, or ask a member of staff.';
  if (err && err.name !== 'ValidationError') console.error('[socket]', err);
  if (typeof ack === 'function') ack({ ok: false, error: message });
  else socket.emit(EVENTS.ERROR, { message });
}

/* ------------------------------------------------------------ broadcasts */

function broadcastNewOrder(io, result) {
  const body = { order: result.order, seq: result.event ? result.event.id : null };
  io.to(ROOMS.kitchen).emit(EVENTS.NEW_ORDER, body);
  io.to(ROOMS.admin).emit(EVENTS.NEW_ORDER, body);
  // Phase 1 station screens are already addressed here.
  for (const station of new Set(result.order.items.map((i) => i.station))) {
    io.to(ROOMS.station(station)).emit(EVENTS.NEW_ORDER, body);
  }
}

function broadcastStatusChange(io, result) {
  const body = { order: result.order, seq: result.event ? result.event.id : null };
  io.to(ROOMS.kitchen).emit(EVENTS.ORDER_STATUS_CHANGED, body);
  io.to(ROOMS.admin).emit(EVENTS.ORDER_STATUS_CHANGED, body);
  io.to(ROOMS.order(result.order.id)).emit(EVENTS.ORDER_STATUS_CHANGED, body);
  for (const station of new Set(result.order.items.map((i) => i.station))) {
    io.to(ROOMS.station(station)).emit(EVENTS.ORDER_STATUS_CHANGED, body);
  }
}

function broadcastMenuChange(io, body) {
  io.to(ROOMS.admin).emit(EVENTS.MENU_CHANGED, body);
  io.to(ROOMS.kitchen).emit(EVENTS.MENU_CHANGED, body);
  io.emit(EVENTS.MENU_CHANGED, body); // customers refresh their menu too
}

module.exports = { attach, broadcastNewOrder, broadcastStatusChange, broadcastMenuChange };
