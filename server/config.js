'use strict';

/**
 * Everything here is read from the environment, never invented. If the
 * restaurant's UPI id is not set, the pay-by-UPI panel simply does not appear —
 * showing a wrong or placeholder VPA would send a customer's money elsewhere.
 */

/**
 * .env holds the UPI id and the Gemini key. If it is readable by other users on
 * the machine, say so loudly — a `cp .env.example .env` inherits whatever the
 * umask gives, which is usually world-readable.
 */
(function warnIfEnvIsOpen() {
  try {
    const path = require('path').join(__dirname, '..', '.env');
    const mode = require('fs').statSync(path).mode & 0o777;
    if (mode & 0o077) {
      console.warn(`\n  WARNING: .env is readable by other users on this machine (mode ${mode.toString(8)}).`);
      console.warn('  It holds your API keys. Fix it with:  chmod 600 .env\n');
    }
  } catch { /* no .env at all is fine */ }
})();

const RESTAURANT = {
  name: process.env.RESTAURANT_NAME || 'Liquid Sky',
  tagline: process.env.RESTAURANT_TAGLINE || 'Family Fine Dine & Bar · Rooftop',
  phone: process.env.RESTAURANT_PHONE || '087927 42988',
  address: process.env.RESTAURANT_ADDRESS
    || 'No. 842/2, Balaji Complex, 2nd Floor, Vidya Nagar Cross Road, Jala Hobli, Yelahanka, Bettahalsoor, Bengaluru 562157',
};

// A UPI virtual payment address looks like name@bank.
const VPA_RE = /^[\w.\-]{2,256}@[a-zA-Z][a-zA-Z0-9.\-]{1,63}$/;

const upiVpa = (process.env.UPI_VPA || '').trim();
const UPI = {
  enabled: VPA_RE.test(upiVpa),
  vpa: VPA_RE.test(upiVpa) ? upiVpa : '',
  payee: (process.env.UPI_PAYEE_NAME || RESTAURANT.name).trim(),
};

if (upiVpa && !UPI.enabled) {
  console.warn(`\n  UPI_VPA "${upiVpa}" is not a valid UPI id (expected name@bank).`);
  console.warn('  Pay-by-UPI stays switched off until it is corrected.\n');
}

/* --------------------------------------------------------------- GST ----
 * Off until a GSTIN is set. Silently starting to charge tax, or charging the
 * wrong rate, is worse than not charging it at all — so nothing here has a
 * working default.
 */
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/;
const gstin = (process.env.GSTIN || '').trim().toUpperCase();
const gstRate = Number(process.env.GST_RATE);

const GST = {
  enabled: GSTIN_RE.test(gstin) && Number.isFinite(gstRate) && gstRate > 0,
  gstin: GSTIN_RE.test(gstin) ? gstin : '',
  rate: Number.isFinite(gstRate) && gstRate > 0 ? gstRate : 5,
  // "Added on top" is how the menu board here is priced.
  pricesIncludeTax: /^(1|true|yes)$/i.test(process.env.GST_PRICES_INCLUDE_TAX || ''),
  invoicePrefix: (process.env.INVOICE_PREFIX || 'HH').trim().toUpperCase().slice(0, 4),
  legalName: (process.env.GST_LEGAL_NAME || '').trim(),
  placeOfSupply: (process.env.GST_PLACE_OF_SUPPLY || 'Karnataka (29)').trim(),
};

if (gstin && !GST.enabled) {
  console.warn(`\n  GSTIN "${gstin}" is not a valid 15-character GSTIN, or GST_RATE is unset.`);
  console.warn('  Tax invoicing stays off until both are correct.\n');
}

const reviewUrl = (process.env.GOOGLE_REVIEW_URL || '').trim();
const REVIEW = {
  enabled: /^https:\/\//.test(reviewUrl),
  url: /^https:\/\//.test(reviewUrl) ? reviewUrl : '',
};

/** The UPI deep link a payment app understands when it reads the QR. */
function upiLink({ amount, note }) {
  if (!UPI.enabled) return null;
  const params = new URLSearchParams({
    pa: UPI.vpa,
    pn: UPI.payee,
    am: Number(amount).toFixed(2),
    cu: 'INR',
  });
  if (note) params.set('tn', String(note).slice(0, 50));
  return `upi://pay?${params.toString()}`;
}

/** Only what is safe to hand to a customer's phone. */
function publicConfig() {
  return {
    restaurant: RESTAURANT,
    upi_enabled: UPI.enabled,
    review: REVIEW,
    gst_enabled: GST.enabled,
    // Set by the assistant service at startup; false unless a Gemini key is set.
    assistant_enabled: !!module.exports.assistantEnabled,
  };
}

module.exports = { RESTAURANT, UPI, REVIEW, GST, upiLink, publicConfig, assistantEnabled: false };
