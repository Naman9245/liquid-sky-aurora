'use strict';

const express = require('express');
const orderService = require('../services/orderService');
const auth = require('../services/authService');
const config = require('../config');
const gst = require('../services/gstService');

const router = express.Router();

// Kitchen tickets and bills are staff-only; the diner sees the same numbers on
// their own phone. These are pages a person opens, not API calls, so a signed-out
// cook lands on the keypad rather than a page of JSON.
router.use(auth.requirePage('KITCHEN', 'MANAGER'));

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const stamp = (ms) => new Date(ms).toLocaleString('en-IN', {
  day: '2-digit', month: 'short', year: 'numeric',
  hour: '2-digit', minute: '2-digit', hour12: true,
});

const rupees = (n) => '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 });

// A tax invoice has to show paise. CGST on a ₹770 bill is ₹19.25, and printing
// ₹19 understates the tax on a document that gets filed.
const paise = (n) => '₹' + Number(n).toLocaleString('en-IN',
  { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function loadOrder(req) {
  const order = orderService.getOrder(Number(req.params.id));
  if (!order) throw Object.assign(new Error('Order not found'), { status: 404 });
  return order;
}

/**
 * 80mm roll, which leaves about 72mm printable. Everything is monospace and
 * left-aligned because that is what these printers render predictably, and the
 * ticket is read at arm's length over a hot pass.
 */
function shell(title, body, auto) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
  @page { size: 80mm auto; margin: 0; }
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { width: 72mm; margin: 0 auto; padding: 4mm 2mm 10mm; background: #fff; color: #000;
         font-family: ui-monospace, "DejaVu Sans Mono", "Courier New", monospace;
         font-size: 12px; line-height: 1.45; }
  .mid { text-align: center; }
  .big { font-size: 19px; font-weight: 700; letter-spacing: .04em; }
  .huge { font-size: 26px; font-weight: 700; line-height: 1.15; }
  .rule { border-top: 1px dashed #000; margin: 7px 0; }
  .row { display: flex; justify-content: space-between; gap: 6px; }
  .line { display: flex; gap: 6px; margin: 5px 0; }
  .qty { min-width: 26px; font-weight: 700; font-size: 15px; }
  .nm { flex: 1; font-size: 15px; font-weight: 600; }
  .amt { text-align: right; white-space: nowrap; }
  .note { margin: 2px 0 0 32px; font-weight: 700; font-size: 13px; }
  .note::before { content: ">> "; }
  .sm { font-size: 11px; }
  .muted { color: #444; }
  .spacer { height: 8mm; }
  .noprint { margin-top: 6mm; text-align: center; }
  .noprint button { font: inherit; padding: 8px 14px; }
  @media print { .noprint { display: none; } }
</style></head><body>
${body}
<div class="noprint"><button onclick="window.print()" type="button">Print</button></div>
${auto ? '<script>window.addEventListener("load", () => window.print());</script>' : ''}
</body></html>`;
}

/* ------------------------------------------------- kitchen order ticket */

router.get('/kot/:id', (req, res, next) => {
  try {
    const order = loadOrder(req);
    const station = (req.query.station || '').toUpperCase();
    const items = station ? order.items.filter((i) => i.station === station) : order.items;
    if (!items.length) throw Object.assign(new Error('Nothing for that station on this order'), { status: 404 });

    const body = `
<div class="mid big">${esc(config.RESTAURANT.name)}</div>
<div class="mid sm muted">KITCHEN ORDER TICKET</div>
<div class="rule"></div>
<div class="mid huge">${esc(order.service_point.label)}</div>
<div class="mid sm">${esc(order.order_type.replace(/_/g, ' '))}${station ? ' · ' + esc(station.replace(/_/g, ' ')) : ''}</div>
<div class="rule"></div>
<div class="row sm"><span>KOT #${order.id}</span><span>${esc(stamp(order.placed_at))}</span></div>
<div class="rule"></div>
${items.map((i) => `<div class="line">
  <span class="qty">${i.quantity}×</span>
  <span class="nm">${esc(i.name)}${i.diet_type === 'NON_VEG' ? ' (N)' : i.diet_type === 'EGG' ? ' (E)' : ''}</span>
</div>${i.special_notes ? `<div class="note">${esc(i.special_notes)}</div>` : ''}`).join('')}
<div class="rule"></div>
${order.notes ? `<div class="note" style="margin-left:0">${esc(order.notes)}</div><div class="rule"></div>` : ''}
<div class="sm muted mid">target ${order.eta_minutes} min</div>
<div class="spacer"></div>`;

    res.type('html').send(shell(`KOT #${order.id}`, body, req.query.auto === '1'));
  } catch (err) { next(err); }
});

/* --------------------------------------------------------- customer bill */

router.get('/bill/:id', (req, res, next) => {
  try {
    const order = loadOrder(req);
    const r = config.RESTAURANT;

    // A voided order is not billed at all, with or without GST. Handing a
    // diner a bill for an order that was cancelled is how disputes start.
    if (order.status === 'CANCELLED') {
      throw Object.assign(new Error('That order was voided, so it cannot be billed.'), { status: 409 });
    }

    // Printing the bill is the moment the diner is charged, so that is when the
    // invoice number is allocated. Issuing is idempotent — reprinting the same
    // bill never produces a second number.
    let invoice = null;
    if (config.GST.enabled) invoice = gst.issueForOrder(order);

    const head = `
<div class="mid big">${esc(invoice ? invoice.legal_name : r.name)}</div>
<div class="mid sm muted">${esc(r.tagline)}</div>
<div class="mid sm muted">${esc(r.address)}</div>
${r.phone ? `<div class="mid sm muted">Ph ${esc(r.phone)}</div>` : ''}
${invoice ? `<div class="mid sm" style="font-weight:700">GSTIN ${esc(invoice.gstin)}</div>` : ''}
<div class="rule"></div>
<div class="mid sm" style="font-weight:700">${invoice ? 'TAX INVOICE' : 'BILL'}</div>
<div class="rule"></div>`;

    const meta = invoice
      ? `<div class="row sm"><span>${esc(invoice.invoice_no)}</span><span>${esc(order.service_point.label)}</span></div>
         <div class="row sm"><span>${esc(stamp(invoice.issued_at))}</span><span>${esc(order.order_type.replace(/_/g, ' '))}</span></div>
         <div class="row sm"><span>Order #${order.id}</span><span>${esc(invoice.place_of_supply)}</span></div>
         <div class="row sm muted"><span>SAC ${esc(gst.SAC_RESTAURANT)}</span><span></span></div>`
      : `<div class="row sm"><span>Bill for order #${order.id}</span><span>${esc(order.service_point.label)}</span></div>
         <div class="row sm"><span>${esc(stamp(order.placed_at))}</span><span>${esc(order.order_type.replace(/_/g, ' '))}</span></div>`;

    const lines = invoice
      ? invoice.lines.map((l) => `<div class="line">
          <span class="qty">${l.quantity}×</span>
          <span class="nm">${esc(l.name)}</span>
          <span class="amt">${esc(paise(l.taxable_value))}</span>
        </div>`).join('')
      : order.items.map((i) => `<div class="line">
          <span class="qty">${i.quantity}×</span>
          <span class="nm">${esc(i.name)}</span>
          <span class="amt">${esc(rupees(i.line_total))}</span>
        </div>`).join('');

    const totals = invoice
      ? `<div class="row sm"><span>Taxable value</span><span>${esc(paise(invoice.taxable_value))}</span></div>
         <div class="row sm"><span>CGST @ ${invoice.cgst_rate}%</span><span>${esc(paise(invoice.cgst_amount))}</span></div>
         <div class="row sm"><span>SGST @ ${invoice.sgst_rate}%</span><span>${esc(paise(invoice.sgst_amount))}</span></div>
         ${invoice.round_off !== 0 ? `<div class="row sm"><span>Round off</span><span>${invoice.round_off > 0 ? '+' : ''}${esc(paise(invoice.round_off))}</span></div>` : ''}
         <div class="rule"></div>
         <div class="row"><strong style="font-size:16px">TOTAL</strong><strong style="font-size:18px">${esc(paise(invoice.total))}</strong></div>`
      : `<div class="row"><strong style="font-size:16px">TOTAL</strong><strong style="font-size:18px">${esc(rupees(order.total))}</strong></div>`;

    const footer = invoice
      ? `<div class="mid sm muted">All amounts in INR. Tax on a reverse-charge basis: No.</div>
         <div class="mid sm muted">Thank you — please come again</div>`
      : `<div class="mid sm muted">This is not a tax invoice.<br>Ask at the counter for a GST bill.</div>
         <div class="mid sm muted">Thank you — please come again</div>`;

    const body = `${head}${meta}<div class="rule"></div>${lines}<div class="rule"></div>${totals}
<div class="rule"></div>
${order.server_name ? `<div class="mid sm">Served by ${esc(order.server_name)}</div>` : ''}
<div class="mid sm">${config.UPI.enabled ? 'Pay by UPI or at the counter' : 'Please pay at the counter'}</div>
<div class="rule"></div>
${footer}
<div class="spacer"></div>`;

    res.type('html').send(shell(
      invoice ? invoice.invoice_no : `Bill #${order.id}`, body, req.query.auto === '1'));
  } catch (err) {
    if (err && (err.name === 'GstError' || err.status === 409)) {
      return res.status(err.status || 409).type('html')
        .send(shell('Cannot bill', `<div class="mid">${esc(err.message)}</div>`, false));
    }
    next(err);
  }
});

module.exports = router;
