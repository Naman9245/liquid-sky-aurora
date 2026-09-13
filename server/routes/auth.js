'use strict';

const express = require('express');
const auth = require('../services/authService');

const router = express.Router();

router.post('/login', (req, res, next) => {
  try {
    const { token, staff, expires_at } = auth.login(req.body.pin, req.ip);
    auth.setSessionCookie(res, token, expires_at);
    res.json({ staff });
  } catch (err) { next(err); }
});

router.post('/logout', (req, res) => {
  auth.logout(auth.readCookie(req, auth.COOKIE));
  auth.clearSessionCookie(res);
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  const staff = auth.currentStaff(req);
  if (!staff) return res.status(401).json({ error: 'Not signed in', login_required: true });
  res.json({ staff });
});

/* ------------------------------------------------------- staff admin */

router.get('/staff', auth.requireStaff('MANAGER'), (req, res) => {
  res.json({ staff: auth.listStaff(), roles: auth.ROLES });
});

router.post('/staff', auth.requireStaff('MANAGER'), (req, res, next) => {
  try { res.status(201).json({ staff: auth.createStaff(req.body) }); }
  catch (err) { next(err); }
});

router.post('/staff/:id/pin', auth.requireStaff('MANAGER'), (req, res, next) => {
  try { res.json({ staff: auth.changePin(Number(req.params.id), req.body.pin) }); }
  catch (err) { next(err); }
});

router.post('/staff/:id/active', auth.requireStaff('MANAGER'), (req, res, next) => {
  try { res.json({ staff: auth.setStaffActive(Number(req.params.id), !!req.body.is_active) }); }
  catch (err) { next(err); }
});

module.exports = router;
