'use strict';

const express = require('express');
const QRCode = require('qrcode');
const menuService = require('../services/menuService');
const servicePoints = require('../services/servicePointService');
const orderService = require('../services/orderService');

const router = express.Router();

function baseUrl(req) {
  return (process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
}

/* ------------------------------------------------------------- menu items */

router.post('/menu-items', (req, res, next) => {
  try {
    const item = menuService.createItem(req.body);
    req.app.locals.broadcastMenuChange({ item, change: 'created' });
    res.status(201).json({ item });
  } catch (err) { next(err); }
});

router.put('/menu-items/:id', (req, res, next) => {
  try {
    const item = menuService.updateItem(Number(req.params.id), req.body);
    if (!item) return next(Object.assign(new Error('Menu item not found'), { status: 404 }));
    req.app.locals.broadcastMenuChange({ item, change: 'updated' });
    res.json({ item });
  } catch (err) { next(err); }
});

router.post('/menu-items/:id/availability', (req, res, next) => {
  try {
    const item = menuService.setAvailability(Number(req.params.id), !!req.body.is_available);
    if (!item) return next(Object.assign(new Error('Menu item not found'), { status: 404 }));
    req.app.locals.broadcastMenuChange({ item, change: 'availability' });
    res.json({ item });
  } catch (err) { next(err); }
});

// Serving times. An empty list means the dish is available all day.
router.put('/menu-items/:id/windows', (req, res, next) => {
  try {
    const windows = menuService.setWindows(Number(req.params.id), req.body.windows);
    if (!windows) return next(Object.assign(new Error('Menu item not found'), { status: 404 }));
    req.app.locals.broadcastMenuChange({ item: menuService.getItem(Number(req.params.id)), change: 'windows' });
    res.json({ windows });
  } catch (err) { next(err); }
});

router.delete('/menu-items/:id', (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const ok = menuService.deleteItem(id);
    if (!ok) return next(Object.assign(new Error('Menu item not found'), { status: 404 }));
    req.app.locals.broadcastMenuChange({ item: { id }, change: 'deleted' });
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

/* --------------------------------------------------------- service points */

router.get('/service-points', (req, res) => {
  const base = baseUrl(req);
  res.json({
    service_points: servicePoints.list().map((sp) => ({ ...sp, url: base + sp.path })),
    kinds: servicePoints.KINDS,
    base_url: base,
  });
});

router.post('/service-points', (req, res, next) => {
  try { res.status(201).json({ service_point: servicePoints.create(req.body) }); }
  catch (err) { next(err); }
});

router.put('/service-points/:id', (req, res, next) => {
  try {
    const sp = servicePoints.edit(Number(req.params.id), req.body);
    if (!sp) return next(Object.assign(new Error('Service point not found'), { status: 404 }));
    res.json({ service_point: sp });
  } catch (err) { next(err); }
});

router.post('/service-points/:id/active', (req, res, next) => {
  try {
    const sp = servicePoints.deactivate(Number(req.params.id), !!req.body.is_active);
    if (!sp) return next(Object.assign(new Error('Service point not found'), { status: 404 }));
    res.json({ service_point: sp });
  } catch (err) { next(err); }
});

// Invalidates the printed tent card — use when a slug leaks.
router.post('/service-points/:id/rotate', (req, res, next) => {
  try {
    const sp = servicePoints.rotateSlug(Number(req.params.id));
    if (!sp) return next(Object.assign(new Error('Service point not found'), { status: 404 }));
    res.json({ service_point: sp });
  } catch (err) { next(err); }
});

/* ------------------------------------------------------------- QR codes */

// A single PNG, for downloading one tent card.
router.get('/service-points/:id/qr.png', async (req, res, next) => {
  try {
    const sp = servicePoints.get(Number(req.params.id));
    if (!sp) return next(Object.assign(new Error('Service point not found'), { status: 404 }));
    const png = await QRCode.toBuffer(baseUrl(req) + sp.path, {
      width: 900, margin: 2, errorCorrectionLevel: 'M',
    });
    res.type('png')
      .set('Content-Disposition', `attachment; filename="hunger-house-${slugify(sp.label)}.png"`)
      .send(png);
  } catch (err) { next(err); }
});

// One A4 sheet of every active tent card, ready to print and cut.
router.get('/qr-sheet', async (req, res, next) => {
  try {
    const base = baseUrl(req);
    const points = servicePoints.list().filter((sp) => sp.is_active);
    const cards = await Promise.all(points.map(async (sp) => ({
      ...sp,
      url: base + sp.path,
      dataUrl: await QRCode.toDataURL(base + sp.path, { width: 420, margin: 1 }),
    })));
    res.type('html').send(renderSheet(cards, base));
  } catch (err) { next(err); }
});

/* ---------------------------------------------------------------- orders */

/**
 * What an accountant asks for: every invoice in a period, the tax totals, and
 * whether the number series has a gap in it.
 */
router.get('/gst', (req, res, next) => {
  try {
    const gst = require('../services/gstService');
    const config = require('../config');
    if (!config.GST.enabled) {
      return res.json({ enabled: false, reason: 'GST invoicing is not switched on.' });
    }
    const now = Date.now();
    const days = Math.min(400, Math.max(1, Number(req.query.days) || 30));
    const from = Number(req.query.from) || (now - days * 86400000);
    const to = Number(req.query.to) || now;
    res.json({ enabled: true, gstin: config.GST.gstin, rate: config.GST.rate, ...gst.summary(from, to) });
  } catch (err) { next(err); }
});

router.get('/analytics', (req, res) => {
  const days = Math.min(90, Math.max(1, Number(req.query.days) || 7));
  res.json(require('../services/analyticsService').getAnalytics({ days }));
});

router.get('/stats', (req, res) => {
  res.json({ stats: orderService.getTodayStats() });
});

function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderSheet(cards, base) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Liquid Sky — table QR codes</title>
<style>
  @page { size: A4; margin: 12mm; }
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; margin: 0;
         color: #111; background: #fff; }
  .hint { padding: 14px 16px; background: #fff4d6; border: 1px solid #e6cf94;
          margin-bottom: 16px; font-size: 13px; line-height: 1.5; }
  .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10mm; }
  .card { border: 1px dashed #999; padding: 8mm 6mm; text-align: center; break-inside: avoid; }
  .card img { width: 62mm; height: 62mm; display: block; margin: 0 auto 5mm; }
  .brand { font-size: 12pt; font-weight: 700; letter-spacing: .04em; margin-bottom: 2mm; }
  .label { font-size: 22pt; font-weight: 800; margin: 0 0 1mm; }
  .kind { font-size: 9pt; color: #666; text-transform: uppercase; letter-spacing: .1em; }
  .scan { margin-top: 4mm; font-size: 10pt; color: #444; }
  .url { margin-top: 2mm; font-family: ui-monospace, monospace; font-size: 7.5pt; color: #888;
         word-break: break-all; }
  @media print { .hint { display: none; } }
</style></head><body>
<div class="hint"><strong>Before printing:</strong> these codes point at <code>${escapeHtml(base)}</code>.
  If that is not the address a customer's phone can reach from inside the restaurant, set
  <code>PUBLIC_BASE_URL</code> in <code>.env</code> and reload this page — otherwise every printed
  code will be dead.</div>
<div class="grid">
${cards.map((c) => `  <div class="card">
    <div class="brand">HUNGER HOUSE</div>
    <p class="label">${escapeHtml(c.label)}</p>
    <div class="kind">${escapeHtml(c.kind.replace(/_/g, ' '))}</div>
    <img src="${c.dataUrl}" alt="QR code for ${escapeHtml(c.label)}">
    <div class="scan">Scan to see the menu &amp; order</div>
    <div class="url">${escapeHtml(c.url)}</div>
  </div>`).join('\n')}
</div>
</body></html>`;
}

module.exports = router;
