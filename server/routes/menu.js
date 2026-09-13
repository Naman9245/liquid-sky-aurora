'use strict';

const express = require('express');
const menuService = require('../services/menuService');
const auth = require('../services/authService');

const router = express.Router();

// What the customer sees: available items only.
router.get('/', (req, res) => {
  res.json({ categories: menuService.getMenu({ onlyAvailable: true }) });
});

// What the owner sees: everything, including sold-out items, plus which
// counter cooks each dish. That is operational detail, not a public menu —
// the customer page reads '/' above, which only lists what is actually on.
router.get('/all', auth.requireStaff('KITCHEN', 'MANAGER'), (req, res) => {
  res.json({
    categories: menuService.getMenu({ onlyAvailable: false }),
    stations: menuService.STATIONS,
    diet_types: menuService.DIET_TYPES,
  });
});

router.get('/categories', (req, res) => {
  res.json({ categories: menuService.listCategories() });
});

module.exports = router;
