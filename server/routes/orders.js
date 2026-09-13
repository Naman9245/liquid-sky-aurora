'use strict';

const express = require('express');
const orderService = require('../services/orderService');
const auth = require('../services/authService');
const QRCode = require('qrcode');
const config = require('../config');

const router = express.Router();

/**
 * The HTTP twin of the place_order socket event. Both call the same service —
 * the moment "place an order" exists twice, the two drift apart.
 */
router.post('/', (req, res, next) => {
  try {
    const result = orderService.placeOrder(req.body);
    if (!result.duplicate) req.app.locals.broadcastNewOrder(result);
    res.status(result.duplicate ? 200 : 201).json({
      order: result.order,
      duplicate: result.duplicate,
    });
  } catch (err) { next(err); }
});

router.get('/active', auth.requireStaff('KITCHEN', 'MANAGER'), (req, res) => {
  res.json({
    orders: orderService.getActiveOrders(),
    last_seq: orderService.getLatestEventId(),
  });
});

router.get('/today', auth.requireStaff('MANAGER'), (req, res) => {
  res.json({ orders: orderService.getTodayOrders(), stats: orderService.getTodayStats() });
});

router.get('/:id', (req, res, next) => {
  const order = orderService.getOrder(Number(req.params.id));
  if (!order) return next(Object.assign(new Error('Order not found'), { status: 404 }));

  if (!auth.currentStaff(req)) {
    const slug = String(req.query.slug || '');
    if (!slug || !orderService.orderBelongsToSlug(order.id, slug)) {
      return next(Object.assign(new Error('Order not found'), { status: 404 }));
    }
  }
  res.json({ order });
});

router.post('/:id/status', auth.requireStaff('KITCHEN', 'MANAGER'), (req, res, next) => {
  try {
    const result = orderService.updateOrderStatus(Number(req.params.id), req.body.status, req.staff);
    req.app.locals.broadcastStatusChange(result);
    res.json({ order: result.order });
  } catch (err) { next(err); }
});

/**
 * The UPI QR for one order. Same table-slug proof as reading the order itself,
 * so a passer-by cannot pull up someone else's bill and its amount.
 */
function payableOrder(req) {
  if (!config.UPI.enabled) {
    throw Object.assign(new Error('Paying by UPI is not set up'), { status: 404 });
  }
  const order = orderService.getOrder(Number(req.params.id));
  if (!order) throw Object.assign(new Error('Order not found'), { status: 404 });
  if (!auth.currentStaff(req) &&
      !orderService.orderBelongsToSlug(order.id, String(req.query.slug || ''))) {
    throw Object.assign(new Error('Order not found'), { status: 404 });
  }
  // With GST on, order.total is the pre-tax figure. Charging that would
  // collect less than the bill says. Always ask for what is actually payable.
  const payable = order.tax_preview ? order.tax_preview.payable : order.total;
  return {
    order,
    payable,
    link: config.upiLink({
      amount: payable,
      note: `${config.RESTAURANT.name} order ${order.id}`,
    }),
  };
}

router.get('/:id/upi-qr.png', async (req, res, next) => {
  try {
    const { link } = payableOrder(req);
    const png = await QRCode.toBuffer(link, { width: 600, margin: 1, errorCorrectionLevel: 'M' });
    res.type('png').set('Cache-Control', 'no-store').send(png);
  } catch (err) { next(err); }
});

// For the "open my UPI app" button, where the phone can follow upi:// directly.
router.get('/:id/upi-link', (req, res, next) => {
  try {
    const { link, payable } = payableOrder(req);
    res.json({ link, amount: payable });
  } catch (err) { next(err); }
});

module.exports = router;
