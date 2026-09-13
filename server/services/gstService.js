'use strict';

const { db } = require('../db');

/**
 * GST invoicing.
 *
 * Two rules shape everything here.
 *
 * First, money is computed in paise as integers. Rupee floats drift, and a
 * tax figure that is a hundredth of a rupee out is a tax figure that is wrong.
 *
 * Second, an invoice is written once and never recomputed. Rule 46 wants a
 * consecutive, unique serial number per financial year; if the numbers were
 * derived from live data, editing a price or voiding an order afterwards would
 * silently rewrite history. So issuing an invoice snapshots every figure, and
 * from then on the stored row is the only truth.
 */

const CONFIG = require('../config');

const SAC_RESTAURANT = '996331';   // Services provided by restaurants, cafes and the like

/* ---------------------------------------------------------- money in paise */

const toPaise = (rupees) => Math.round(Number(rupees) * 100);
const toRupees = (paise) => paise / 100;

/** Indian financial year runs April to March. April 2026 is "26-27". */
function financialYear(at = Date.now()) {
  const d = new Date(at);
  const y = d.getFullYear();
  const start = d.getMonth() >= 3 ? y : y - 1;   // month 3 = April
  return `${String(start % 100).padStart(2, '0')}-${String((start + 1) % 100).padStart(2, '0')}`;
}

/**
 * Splits an order into taxable value and tax. The whole rate is split equally
 * between CGST and SGST, which is correct for a sale inside one state — every
 * order here is eaten or collected on the premises in Karnataka.
 */
function computeTax(items, { rate, pricesIncludeTax }) {
  const gross = items.reduce((sum, i) => sum + toPaise(i.price) * i.quantity, 0);

  let taxable;
  if (pricesIncludeTax) {
    // Work the tax back out of the price the diner already sees.
    taxable = Math.round((gross * 10000) / (10000 + rate * 100));
  } else {
    taxable = gross;
  }

  const totalTax = pricesIncludeTax ? gross - taxable : Math.round((taxable * rate) / 100);
  // Halve the tax, not the rate, so the two halves always add back to the total.
  const cgst = Math.round(totalTax / 2);
  const sgst = totalTax - cgst;

  const exact = taxable + cgst + sgst;
  const rounded = Math.round(exact / 100) * 100;     // to the nearest rupee
  const roundOff = rounded - exact;

  const lines = items.map((i) => {
    const lineGross = toPaise(i.price) * i.quantity;
    const lineTaxable = pricesIncludeTax
      ? Math.round((lineGross * 10000) / (10000 + rate * 100))
      : lineGross;
    return {
      name: i.name,
      quantity: i.quantity,
      unit_price: toRupees(pricesIncludeTax
        ? Math.round((toPaise(i.price) * 10000) / (10000 + rate * 100))
        : toPaise(i.price)),
      taxable_value: toRupees(lineTaxable),
      sac: SAC_RESTAURANT,
    };
  });

  return {
    lines,
    taxable_value: toRupees(taxable),
    cgst_rate: rate / 2,
    sgst_rate: rate / 2,
    cgst_amount: toRupees(cgst),
    sgst_amount: toRupees(sgst),
    round_off: toRupees(roundOff),
    total: toRupees(rounded),
    prices_include_tax: !!pricesIncludeTax,
  };
}

/* ------------------------------------------------------- invoice numbers */

const lastForYear = db.prepare(
  'SELECT COALESCE(MAX(serial), 0) AS last FROM invoices WHERE financial_year = ?'
);

/**
 * Rule 46 wants a consecutive series with no gaps. Allocating the number and
 * writing the row in one transaction is what keeps it consecutive when two
 * bills are printed at the same moment.
 */
function nextSerial(fy) {
  return lastForYear.get(fy).last + 1;
}

function formatNumber(prefix, fy, serial) {
  return `${prefix}/${fy}/${String(serial).padStart(6, '0')}`;   // e.g. HH/25-26/000042
}

/* ------------------------------------------------------------- issuing */

const selectByOrder = db.prepare('SELECT * FROM invoices WHERE order_id = ?');
const insertInvoice = db.prepare(`
  INSERT INTO invoices (
    order_id, invoice_no, financial_year, serial, issued_at,
    gstin, legal_name, place_of_supply,
    taxable_value, cgst_rate, cgst_amount, sgst_rate, sgst_amount,
    round_off, total, prices_include_tax, lines_json
  ) VALUES (
    @order_id, @invoice_no, @financial_year, @serial, @issued_at,
    @gstin, @legal_name, @place_of_supply,
    @taxable_value, @cgst_rate, @cgst_amount, @sgst_rate, @sgst_amount,
    @round_off, @total, @prices_include_tax, @lines_json
  )
`);

class GstError extends Error {
  constructor(message, status = 400) { super(message); this.name = 'GstError'; this.status = status; }
}

function shape(row) {
  return {
    id: row.id,
    order_id: row.order_id,
    invoice_no: row.invoice_no,
    financial_year: row.financial_year,
    serial: row.serial,
    issued_at: row.issued_at,
    gstin: row.gstin,
    legal_name: row.legal_name,
    place_of_supply: row.place_of_supply,
    taxable_value: row.taxable_value,
    cgst_rate: row.cgst_rate,
    cgst_amount: row.cgst_amount,
    sgst_rate: row.sgst_rate,
    sgst_amount: row.sgst_amount,
    round_off: row.round_off,
    total: row.total,
    prices_include_tax: !!row.prices_include_tax,
    lines: JSON.parse(row.lines_json),
  };
}

function getForOrder(orderId) {
  const row = selectByOrder.get(orderId);
  return row ? shape(row) : null;
}

/**
 * Issues the invoice for an order, or returns the one already issued. Called
 * when the bill is printed — the moment the diner is actually charged.
 */
function issueForOrder(order) {
  if (!CONFIG.GST.enabled) throw new GstError('GST invoicing is not switched on.', 409);

  const existing = getForOrder(order.id);
  if (existing) return existing;          // never renumber an order

  if (order.status === 'CANCELLED') {
    throw new GstError('That order was voided. A voided order cannot be given a tax invoice.', 409);
  }
  if (!order.items.length) throw new GstError('That order has nothing on it.', 409);

  const tax = computeTax(order.items, {
    rate: CONFIG.GST.rate,
    pricesIncludeTax: CONFIG.GST.pricesIncludeTax,
  });

  const issuedAt = Date.now();
  const fy = financialYear(issuedAt);

  const run = db.transaction(() => {
    const serial = nextSerial(fy);
    insertInvoice.run({
      order_id: order.id,
      invoice_no: formatNumber(CONFIG.GST.invoicePrefix, fy, serial),
      financial_year: fy,
      serial,
      issued_at: issuedAt,
      gstin: CONFIG.GST.gstin,
      legal_name: CONFIG.GST.legalName || CONFIG.RESTAURANT.name,
      place_of_supply: CONFIG.GST.placeOfSupply,
      taxable_value: tax.taxable_value,
      cgst_rate: tax.cgst_rate,
      cgst_amount: tax.cgst_amount,
      sgst_rate: tax.sgst_rate,
      sgst_amount: tax.sgst_amount,
      round_off: tax.round_off,
      total: tax.total,
      prices_include_tax: tax.prices_include_tax ? 1 : 0,
      lines_json: JSON.stringify(tax.lines),
    });
    return serial;
  });

  run();
  return getForOrder(order.id);
}

/* ----------------------------------------------------- the filing summary */

const selectRange = db.prepare(
  'SELECT * FROM invoices WHERE issued_at >= ? AND issued_at <= ? ORDER BY serial'
);

/** What an accountant needs to file a return for a period. */
function summary(from, to) {
  const rows = selectRange.all(from, to).map(shape);
  const sum = (f) => rows.reduce((s, r) => s + r[f], 0);

  // A gap in the series is the thing an auditor looks for first, so say so.
  const gaps = [];
  const byYear = new Map();
  for (const r of rows) {
    if (!byYear.has(r.financial_year)) byYear.set(r.financial_year, []);
    byYear.get(r.financial_year).push(r.serial);
  }
  for (const [fy, serials] of byYear) {
    serials.sort((a, b) => a - b);
    for (let i = 1; i < serials.length; i++) {
      if (serials[i] !== serials[i - 1] + 1) {
        gaps.push({ financial_year: fy, after: serials[i - 1], before: serials[i] });
      }
    }
  }

  return {
    from, to,
    count: rows.length,
    first: rows.length ? rows[0].invoice_no : null,
    last: rows.length ? rows[rows.length - 1].invoice_no : null,
    taxable_value: sum('taxable_value'),
    cgst_amount: sum('cgst_amount'),
    sgst_amount: sum('sgst_amount'),
    total_tax: sum('cgst_amount') + sum('sgst_amount'),
    round_off: sum('round_off'),
    total: sum('total'),
    // A gap means an invoice number was allocated and its row never landed.
    // It is not proof of wrongdoing, but it is what gets questioned.
    series_gaps: gaps,
    invoices: rows,
  };
}

module.exports = {
  computeTax, financialYear, formatNumber, issueForOrder, getForOrder,
  summary, GstError, SAC_RESTAURANT, toPaise, toRupees,
};
