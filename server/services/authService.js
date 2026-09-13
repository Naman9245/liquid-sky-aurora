'use strict';

const crypto = require('crypto');
const { db } = require('../db');
const { ValidationError } = require('./menuService');

const ROLES = ['KITCHEN', 'MANAGER'];
const SESSION_HOURS = 14;           // one long shift, plus the close-down
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

/* ------------------------------------------------------------- hashing */

function hashPin(pin, salt) {
  return crypto.scryptSync(String(pin), salt, 32).toString('hex');
}

function newSalt() {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Compared with timingSafeEqual so a wrong PIN takes the same time as a right
 * one. Overkill for four digits behind a rate limiter, but it costs nothing.
 */
function pinMatches(pin, row) {
  const candidate = Buffer.from(hashPin(pin, row.pin_salt), 'hex');
  const stored = Buffer.from(row.pin_hash, 'hex');
  return candidate.length === stored.length && crypto.timingSafeEqual(candidate, stored);
}

function validPinFormat(pin) {
  return /^\d{4,8}$/.test(String(pin || ''));
}

/* --------------------------------------------------------------- staff */

const selectActiveStaff = db.prepare('SELECT * FROM staff WHERE is_active = 1');
const selectStaffById = db.prepare('SELECT * FROM staff WHERE id = ?');
const selectStaffByName = db.prepare('SELECT * FROM staff WHERE name = ? COLLATE NOCASE');
const selectAllStaff = db.prepare('SELECT * FROM staff ORDER BY is_active DESC, role, name');
const insertStaff = db.prepare(`
  INSERT INTO staff (name, pin_hash, pin_salt, role, is_active, created_at)
  VALUES (@name, @pin_hash, @pin_salt, @role, 1, @created_at)
`);
const updatePin = db.prepare('UPDATE staff SET pin_hash = ?, pin_salt = ? WHERE id = ?');
const updateActive = db.prepare('UPDATE staff SET is_active = ? WHERE id = ?');

function shapeStaff(row) {
  return { id: row.id, name: row.name, role: row.role, is_active: !!row.is_active };
}

function listStaff() { return selectAllStaff.all().map(shapeStaff); }

function createStaff({ name, pin, role }) {
  if (!name || !String(name).trim()) throw new ValidationError('Name is required');
  if (!ROLES.includes(role)) throw new ValidationError(`Role must be ${ROLES.join(' or ')}`);
  if (!validPinFormat(pin)) throw new ValidationError('PIN must be 4 to 8 digits');
  if (selectStaffByName.get(String(name).trim())) {
    throw new ValidationError('Someone with that name already has a PIN');
  }
  if (pinInUse(pin)) {
    throw new ValidationError('That PIN is already taken — please choose another');
  }
  const salt = newSalt();
  const info = insertStaff.run({
    name: String(name).trim(),
    pin_hash: hashPin(pin, salt),
    pin_salt: salt,
    role,
    created_at: Date.now(),
  });
  return shapeStaff(selectStaffById.get(Number(info.lastInsertRowid)));
}

/**
 * Login is by PIN alone, so two people sharing a PIN would make attribution a
 * lie. Refuse the collision at the point it is created.
 */
function pinInUse(pin, exceptId = null) {
  return selectActiveStaff.all()
    .some((row) => row.id !== exceptId && pinMatches(pin, row));
}

function changePin(staffId, pin) {
  const row = selectStaffById.get(staffId);
  if (!row) throw new ValidationError('No such staff member');
  if (!validPinFormat(pin)) throw new ValidationError('PIN must be 4 to 8 digits');
  if (pinInUse(pin, staffId)) throw new ValidationError('That PIN is already taken');
  const salt = newSalt();
  updatePin.run(hashPin(pin, salt), salt, staffId);
  clearSessionsFor(staffId);           // an old PIN must not keep a session alive
  return shapeStaff(selectStaffById.get(staffId));
}

function setStaffActive(staffId, isActive) {
  const row = selectStaffById.get(staffId);
  if (!row) throw new ValidationError('No such staff member');
  if (!isActive && row.role === 'MANAGER' && countActiveManagers() <= 1) {
    throw new ValidationError('That is the last manager — you would lock yourself out');
  }
  updateActive.run(isActive ? 1 : 0, staffId);
  if (!isActive) clearSessionsFor(staffId);
  return shapeStaff(selectStaffById.get(staffId));
}

function countActiveManagers() {
  return db.prepare("SELECT COUNT(*) n FROM staff WHERE is_active = 1 AND role = 'MANAGER'").get().n;
}

/* ------------------------------------------------------------ sessions */

const insertSession = db.prepare(`
  INSERT INTO sessions (token, staff_id, created_at, expires_at)
  VALUES (?, ?, ?, ?)
`);
const selectSession = db.prepare(`
  SELECT s.token, s.expires_at, st.id, st.name, st.role, st.is_active
  FROM sessions s JOIN staff st ON st.id = s.staff_id
  WHERE s.token = ?
`);
const deleteSession = db.prepare('DELETE FROM sessions WHERE token = ?');
const deleteSessionsForStaff = db.prepare('DELETE FROM sessions WHERE staff_id = ?');
const deleteExpired = db.prepare('DELETE FROM sessions WHERE expires_at < ?');

function clearSessionsFor(staffId) { deleteSessionsForStaff.run(staffId); }

/* Brute force guard. In memory is right here: a restart clears it, and the
   whole system is a single process on one machine in one restaurant. */
const attempts = new Map();

function throttleKey(ip) { return ip || 'unknown'; }

function attemptsLeft(ip) {
  const rec = attempts.get(throttleKey(ip));
  if (!rec) return MAX_ATTEMPTS;
  if (Date.now() > rec.until) { attempts.delete(throttleKey(ip)); return MAX_ATTEMPTS; }
  return Math.max(0, MAX_ATTEMPTS - rec.count);
}

function noteFailure(ip) {
  const key = throttleKey(ip);
  const rec = attempts.get(key);
  if (!rec || Date.now() > rec.until) {
    attempts.set(key, { count: 1, until: Date.now() + LOCKOUT_MS });
  } else {
    rec.count += 1;
    rec.until = Date.now() + LOCKOUT_MS;   // each failure extends the window
  }
}

function clearFailures(ip) { attempts.delete(throttleKey(ip)); }

/**
 * Keyed by IP, so a scanner hitting from many addresses would grow this map
 * without bound. Entries past their window carry no information — drop them.
 */
function sweepAttempts() {
  const now = Date.now();
  let dropped = 0;
  for (const [key, rec] of attempts) {
    if (now > rec.until) { attempts.delete(key); dropped += 1; }
  }
  return dropped;
}
const attemptSweeper = setInterval(sweepAttempts, 15 * 60 * 1000);
attemptSweeper.unref();

function login(pin, ip) {
  if (attemptsLeft(ip) <= 0) {
    throw new ValidationError('Too many wrong PINs. Wait 15 minutes, or ask the manager.');
  }
  if (!validPinFormat(pin)) {
    noteFailure(ip);
    throw new ValidationError('A PIN is 4 to 8 digits');
  }

  const match = selectActiveStaff.all().find((row) => pinMatches(pin, row));
  if (!match) {
    noteFailure(ip);
    const left = attemptsLeft(ip);
    throw new ValidationError(
      left > 0 ? `That PIN was not recognised. ${left} ${left === 1 ? 'try' : 'tries'} left.`
               : 'Too many wrong PINs. Wait 15 minutes, or ask the manager.'
    );
  }

  clearFailures(ip);
  deleteExpired.run(Date.now());

  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  insertSession.run(token, match.id, now, now + SESSION_HOURS * 3600 * 1000);
  return { token, staff: shapeStaff(match), expires_at: now + SESSION_HOURS * 3600 * 1000 };
}

function logout(token) { if (token) deleteSession.run(token); }

function staffForToken(token) {
  if (!token) return null;
  const row = selectSession.get(token);
  if (!row) return null;
  if (row.expires_at < Date.now() || !row.is_active) { deleteSession.run(token); return null; }
  return { id: row.id, name: row.name, role: row.role };
}

/* --------------------------------------------------------- http glue */

const COOKIE = 'hh_session';

// One cookie, parsed by hand — not worth a dependency.
function readCookie(req, name) {
  const header = req.headers ? req.headers.cookie : null;
  if (!header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

function currentStaff(req) {
  return staffForToken(readCookie(req, COOKIE));
}

function setSessionCookie(res, token, expiresAt) {
  const maxAge = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
  // No Secure flag: this runs over plain http on the restaurant LAN. If it is
  // ever put behind TLS, add it here.
  res.setHeader('Set-Cookie',
    `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}`);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

/** API guard: answers with 401 so the browser can redirect itself. */
function requireStaff(...roles) {
  return (req, res, next) => {
    const staff = currentStaff(req);
    if (!staff) return res.status(401).json({ error: 'Please sign in', login_required: true });
    if (roles.length && !roles.includes(staff.role)) {
      return res.status(403).json({ error: 'Your PIN does not have access to this' });
    }
    req.staff = staff;
    next();
  };
}

/** Page guard: sends the browser to the login screen and back again. */
function requirePage(...roles) {
  return (req, res, next) => {
    const staff = currentStaff(req);
    if (!staff) {
      const back = encodeURIComponent(req.originalUrl || '/');
      return res.redirect(`/login?next=${back}`);
    }
    if (roles.length && !roles.includes(staff.role)) {
      // Signed in, wrong screen. Bouncing to the keypad would loop them: a valid
      // PIN sends them right back here. Send them where their PIN does work.
      return res.redirect(staff.role === 'MANAGER' ? '/admin/' : '/kitchen/');
    }
    req.staff = staff;
    next();
  };
}

module.exports = {
  ROLES, COOKIE,
  listStaff, createStaff, changePin, setStaffActive, countActiveManagers,
  login, logout, staffForToken, currentStaff,
  readCookie, setSessionCookie, clearSessionCookie,
  requireStaff, requirePage, hashPin, newSalt, validPinFormat, sweepAttempts,
};
