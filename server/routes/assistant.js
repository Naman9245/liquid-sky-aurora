'use strict';

const express = require('express');
const assistant = require('../services/assistantService');
const orderService = require('../services/orderService');
const servicePoints = require('../services/servicePointService');

const router = express.Router();

/**
 * Open to diners, because it is reached from a table's QR page — but a caller
 * must prove they are at a table, and each table gets a limited number of
 * questions. Every call spends money at Google.
 */
router.post('/ask', async (req, res, next) => {
  try {
    const slug = String(req.body.qr_slug || '');
    const point = servicePoints.getBySlug(slug);
    if (!point) {
      return next(Object.assign(new Error('That QR code is not valid.'), { status: 404 }));
    }

    const answer = await assistant.ask({
      question: req.body.question,
      lang: ['en', 'hi', 'kn'].includes(req.body.lang) ? req.body.lang : 'en',
      rateKey: slug,
    });
    res.json(answer);
  } catch (err) {
    if (err && err.name === 'AssistantError') {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
});

module.exports = router;
