/**
 * Liquid Sky Family Fine Dine & Bar — site + API server.
 *
 * Zero npm dependencies. node:http, node:sqlite, node:crypto, node:fs only.
 *
 *   PORT           listen port (default 8788)
 *   ADMIN_PASSWORD admin password; if unset a random one is printed once at boot
 *   TRUST_PROXY    set to 1 only when behind a reverse proxy you control
 *   LS_DB_PATH     override the database location (default server/data/liquid-sky.db)
 */

import { createServer } from 'node:http';
import { createReadStream, promises as fsp } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { gzipSync } from 'node:zlib';

import {
  SERVER_DIR,
  SITE_ROOT,
  DB_PATH,
  menuPayload,
  publicItem,
  countMenuItems,
  countReservationsOn,
  listReservationsOn,
  createReservation,
  createOrder,
  setReservationStatus,
  updateMenuItem,
  RESERVATION_STATUSES,
  istDateString,
  toIstIso,
  IST_SUFFIX,
  rupeesToPaise,
  paiseToRupees,
  closeDb,
} from './db.mjs';

const PORT = Number(process.env.PORT) || 8788;
const TRUST_PROXY = process.env.TRUST_PROXY === '1' || process.env.TRUST_PROXY === 'true';
const MAX_BODY_BYTES = 32 * 1024;
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const SESSION_COOKIE = 'ls_admin';

/* ============================================================ admin secret == */

const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
function readablePassword() {
  const bytes = randomBytes(20);
  let out = '';
  for (let i = 0; i < 20; i++) {
    if (i && i % 5 === 0) out += '-';
    out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return out;
}

const GENERATED_PASSWORD = !process.env.ADMIN_PASSWORD;
// No default like "admin" anywhere: unset env means a fresh random secret per boot.
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || readablePassword();
const ADMIN_PASSWORD_DIGEST = createHash('sha256').update(ADMIN_PASSWORD, 'utf8').digest();

/** Constant-time compare. Both sides are hashed first so the buffers always match length. */
function passwordMatches(candidate) {
  if (typeof candidate !== 'string' || candidate.length === 0 || candidate.length > 512) {
    // Still do the compare so a wrong-shape guess costs the same as a wrong password.
    timingSafeEqual(createHash('sha256').update('', 'utf8').digest(), ADMIN_PASSWORD_DIGEST);
    return false;
  }
  const digest = createHash('sha256').update(candidate, 'utf8').digest();
  return timingSafeEqual(digest, ADMIN_PASSWORD_DIGEST);
}

/* ================================================================ sessions == */

/** token -> expiresAt (ms). In-memory on purpose: restart = everyone logs in again. */
const sessions = new Map();

function newSession() {
  const token = randomBytes(32).toString('hex');
  const expiresAt = Date.now() + SESSION_TTL_MS;
  sessions.set(token, expiresAt);
  return { token, expiresAt };
}

function sessionValid(token) {
  if (!token) return false;
  const expiresAt = sessions.get(token);
  if (!expiresAt) return false;
  if (expiresAt <= Date.now()) {
    sessions.delete(token);
    return false;
  }
  return true;
}

function parseCookies(header) {
  const out = Object.create(null);
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    if (!k) continue;
    out[k] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

/* ============================================================ rate limiting == */

/** key -> timestamps[]. Sliding window, no dependency, good enough for one shop. */
const rateBuckets = new Map();

function bucket(key) {
  let hits = rateBuckets.get(key);
  if (!hits) {
    hits = [];
    rateBuckets.set(key, hits);
  }
  return hits;
}

/** Is this key already at its cap? Does not consume quota. */
function rateCheck(key, max, windowMs) {
  const now = Date.now();
  const hits = bucket(key);
  while (hits.length && now - hits[0] > windowMs) hits.shift();
  if (hits.length >= max) {
    return { ok: false, retryAfter: Math.max(1, Math.ceil((windowMs - (now - hits[0])) / 1000)) };
  }
  return { ok: true };
}

/** Consume one slot. */
function rateHit(key) {
  bucket(key).push(Date.now());
}

/** Check and consume in one go — the right shape for login attempts. */
function rateLimit(key, max, windowMs) {
  const result = rateCheck(key, max, windowMs);
  if (result.ok) rateHit(key);
  return result;
}

/**
 * Reservations and orders are capped on *successful writes*, not on attempts, so a
 * guest who fat-fingers their phone number four times doesn't lose their booking slot.
 * A much looser attempt cap sits behind it to stop anyone probing validation for free.
 */
const WINDOW_10_MIN = 10 * 60 * 1000;
const LIMITS = {
  reservations: { max: 5, attempts: 40 },
  orders: { max: 10, attempts: 60 },
};

function guardWrite(kind, ip, res) {
  const { max, attempts } = LIMITS[kind];
  const attempt = rateLimit(`${kind}:attempt:${ip}`, attempts, WINDOW_10_MIN);
  if (!attempt.ok) {
    tooMany(res, attempt.retryAfter);
    return false;
  }
  const created = rateCheck(`${kind}:ok:${ip}`, max, WINDOW_10_MIN);
  if (!created.ok) {
    tooMany(res, created.retryAfter);
    return false;
  }
  return true;
}

const recordWrite = (kind, ip) => rateHit(`${kind}:ok:${ip}`);

const sweep = setInterval(() => {
  const now = Date.now();
  for (const [key, hits] of rateBuckets) {
    while (hits.length && now - hits[0] > 15 * 60 * 1000) hits.shift();
    if (!hits.length) rateBuckets.delete(key);
  }
  for (const [token, expiresAt] of sessions) if (expiresAt <= now) sessions.delete(token);
}, 60_000);
sweep.unref();

function clientIp(req) {
  if (TRUST_PROXY) {
    const xff = req.headers['x-forwarded-for'];
    if (typeof xff === 'string' && xff.length) return xff.split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'unknown';
}

/* ================================================================ replies === */

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

/* ---------------------------------------------------------- COMPRESSION ---
   Text was going out raw: app.js alone was 65KB on the wire where gzip
   makes it 22KB, and the whole HTML/CSS/JS/JSON critical path was ~155KB
   instead of ~45KB. node:zlib is built in, so this costs no dependency.

   Only text is compressed — mp4, jpg, png and webp are already compressed
   and running them through gzip burns CPU to make them very slightly
   bigger. Results are memoised against the file's mtime so a repeat
   request re-uses the buffer instead of re-compressing. */
const COMPRESSIBLE = new Set([
  '.html', '.css', '.js', '.mjs', '.json', '.svg', '.xml', '.txt', '.webmanifest',
]);
const gzCache = new Map();          // path -> { key, buf }

function acceptsGzip(req) {
  return /\bgzip\b/.test(req.headers['accept-encoding'] || '');
}

function gzipCached(key, buf) {
  const hit = gzCache.get(key);
  if (hit) return hit;
  const out = gzipSync(buf, { level: 6 });
  if (gzCache.size > 64) gzCache.clear();     // tiny site; a flush is fine
  gzCache.set(key, out);
  return out;
}

function send(res, status, headers, body) {
  if (res.writableEnded) return;
  const h = { ...SECURITY_HEADERS, ...headers };
  res.writeHead(status, h);
  if (body === undefined || body === null) res.end();
  else res.end(body);
}

function sendJson(res, status, payload, headers = {}) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  send(res, status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    ...headers,
  }, body);
}

const badRequest = (res, error, field) =>
  sendJson(res, 400, field ? { error, field } : { error });

function tooMany(res, retryAfter) {
  sendJson(res, 429, { error: 'rate_limited', retry_after: retryAfter }, {
    'Retry-After': String(retryAfter),
  });
}

/* =============================================================== body read == */

class BodyTooLarge extends Error {}

function readBody(req, limit = MAX_BODY_BYTES) {
  return new Promise((resolveBody, rejectBody) => {
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > limit) {
      rejectBody(new BodyTooLarge());
      return;
    }
    let size = 0;
    const chunks = [];
    let done = false;
    req.on('data', (chunk) => {
      if (done) return;
      size += chunk.length;
      if (size > limit) {
        done = true;
        rejectBody(new BodyTooLarge());
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (done) return;
      done = true;
      resolveBody(Buffer.concat(chunks));
    });
    req.on('error', (err) => {
      if (done) return;
      done = true;
      rejectBody(err);
    });
  });
}

async function readJson(req, res) {
  let raw;
  try {
    raw = await readBody(req);
  } catch (err) {
    if (err instanceof BodyTooLarge) {
      sendJson(res, 413, { error: 'payload_too_large', limit_bytes: MAX_BODY_BYTES }, {
        Connection: 'close',
      });
    } else {
      sendJson(res, 400, { error: 'bad_request' });
    }
    return undefined;
  }
  if (!raw.length) return {};
  try {
    const parsed = JSON.parse(raw.toString('utf8'));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      sendJson(res, 400, { error: 'invalid_json' });
      return undefined;
    }
    return parsed;
  } catch {
    sendJson(res, 400, { error: 'invalid_json' });
    return undefined;
  }
}

/* ============================================================== validation == */

const NAME_MIN = 2;
const NAME_MAX = 80;
const NOTE_MAX = 500;
const MAX_PARTY = 20;
const BOOKING_HORIZON_DAYS = 90;

function validateName(value) {
  if (typeof value !== 'string') return { error: 'name_required' };
  const name = value.trim().replace(/\s+/g, ' ');
  if (name.length < NAME_MIN) return { error: 'name_too_short' };
  if (name.length > NAME_MAX) return { error: 'name_too_long' };
  if (/[\u0000-\u001f\u007f]/.test(name)) return { error: 'name_invalid' };
  return { value: name };
}

/**
 * Indian mobile numbers. Accepts 9876543210, 09876543210, 919876543210,
 * +91 98765 43210, +91-98765-43210. Normalises to +919876543210.
 */
function validatePhone(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return { error: 'phone_required' };
  const raw = String(value).trim();
  if (!raw) return { error: 'phone_required' };
  if (!/^\+?[\d\s\-().]+$/.test(raw)) return { error: 'phone_invalid' };

  let digits = raw.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  else if (digits.length === 13 && digits.startsWith('091')) digits = digits.slice(3);

  if (digits.length !== 10) return { error: 'phone_invalid' };
  if (!/^[6-9]\d{9}$/.test(digits)) return { error: 'phone_invalid' };
  return { value: `+91${digits}` };
}

function validatePartySize(value) {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) return { error: 'party_size_required' };
  if (!Number.isInteger(n)) return { error: 'party_size_invalid' };
  if (n < 1) return { error: 'party_size_too_small' };
  if (n > MAX_PARTY) return { error: 'party_size_too_large' };
  return { value: n };
}

/**
 * Accepts an ISO datetime. A bare "2026-09-11T20:30" (what <input type=datetime-local>
 * emits) is read as IST wall-clock time, which is what the guest meant. An instant with
 * Z or an explicit offset is converted to the same instant expressed in IST.
 */
function validateSlot(value) {
  if (typeof value !== 'string' || !value.trim()) return { error: 'slot_at_required' };
  const raw = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/.test(raw)) {
    return { error: 'slot_at_invalid' };
  }
  const hasZone = /(Z|[+-]\d{2}:?\d{2})$/.test(raw);
  const normalised = raw.replace(' ', 'T');
  const date = new Date(hasZone ? normalised : `${normalised}${IST_SUFFIX}`);
  if (Number.isNaN(date.getTime())) return { error: 'slot_at_invalid' };

  const now = Date.now();
  if (date.getTime() <= now) return { error: 'slot_at_past' };
  if (date.getTime() > now + BOOKING_HORIZON_DAYS * 86_400_000) return { error: 'slot_at_too_far' };

  return { value: toIstIso(date) };
}

function validateNote(value) {
  if (value === undefined || value === null || value === '') return { value: null };
  if (typeof value !== 'string') return { error: 'note_invalid' };
  const note = value.trim();
  if (note.length > NOTE_MAX) return { error: 'note_too_long' };
  // eslint-disable-next-line no-control-regex
  return { value: note.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '') || null };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function validDateParam(value) {
  if (!DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00${IST_SUFFIX}`);
  return !Number.isNaN(d.getTime()) && istDateString(d) === value;
}

/* ============================================================ menu caching == */

let menuCache = null;

function invalidateMenuCache() {
  menuCache = null;
}

function getMenuResponse() {
  if (menuCache) return menuCache;
  const { categories, items } = menuPayload();
  const version = createHash('sha256')
    .update(JSON.stringify({ categories, items }))
    .digest('hex')
    .slice(0, 12);
  const body = Buffer.from(JSON.stringify({ version, categories, items }), 'utf8');
  menuCache = { version, etag: `"${version}"`, body };
  return menuCache;
}

function etagMatches(header, etag) {
  if (!header) return false;
  if (header.trim() === '*') return true;
  return header
    .split(',')
    .map((t) => t.trim().replace(/^W\//, ''))
    .some((t) => t === etag);
}

/* ============================================================ CSRF posture == */

/**
 * The session cookie is SameSite=Strict, so a cross-site form can't ride along.
 * Belt and braces: state-changing API calls must be JSON, and if the browser
 * sends an Origin it has to be our own.
 */
function originOk(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // curl, native apps, same-origin GET
  try {
    const host = req.headers.host;
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function jsonRequestOk(req) {
  const ct = req.headers['content-type'];
  if (!ct) return true; // allow bodyless PATCH/POST from curl
  return /^application\/json\b/i.test(ct.trim());
}

/* ============================================================ static files == */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.pdf': 'application/pdf',
};

const IMMUTABLE = new Set([
  '.mp4', '.m4v', '.webm', '.mov', '.mp3', '.m4a',
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.ico',
  '.woff', '.woff2', '.ttf',
]);

/** server/ holds the database and this source — never serve it over HTTP. */
const SERVER_DIR_PREFIX = SERVER_DIR + sep;

function resolveStaticPath(pathname) {
  if (pathname.includes('\u0000')) return null;
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes('..') || decoded.includes('\u0000')) return null;
  if (decoded.endsWith('/')) decoded += 'index.html';
  // No dotfiles: .git, .gitignore, .env and friends stay private.
  if (decoded.split('/').some((seg) => seg.startsWith('.') && seg.length > 1)) return null;

  const full = resolve(join(SITE_ROOT, `.${decoded}`));
  if (full !== SITE_ROOT && !full.startsWith(SITE_ROOT + sep)) return null;
  if (full === SERVER_DIR || full.startsWith(SERVER_DIR_PREFIX)) return null;
  return full;
}

function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!m) return 'invalid';
  const [, rawStart, rawEnd] = m;
  if (rawStart === '' && rawEnd === '') return 'invalid';

  let start;
  let end;
  if (rawStart === '') {
    const suffix = Number(rawEnd);
    if (!Number.isFinite(suffix) || suffix <= 0) return 'invalid';
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd === '' ? size - 1 : Number(rawEnd);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return 'invalid';
    if (end > size - 1) end = size - 1;
  }
  if (start > end || start >= size) return 'unsatisfiable';
  return { start, end };
}

async function serveFile(req, res, filePath, extraHeaders = {}) {
  let stat;
  try {
    stat = await fsp.stat(filePath);
    if (stat.isDirectory()) {
      const indexPath = join(filePath, 'index.html');
      stat = await fsp.stat(indexPath);
      filePath = indexPath;
    }
  } catch {
    send(res, 404, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Not found');
    return;
  }

  const ext = extname(filePath).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  const lastModified = stat.mtime.toUTCString();
  const etag = `W/"${stat.size.toString(16)}-${stat.mtimeMs.toString(16)}"`;
  const cache = IMMUTABLE.has(ext)
    ? 'public, max-age=86400'
    : 'public, max-age=0, must-revalidate';

  const base = {
    'Content-Type': type,
    'Last-Modified': lastModified,
    ETag: etag,
    'Cache-Control': cache,
    'Accept-Ranges': 'bytes',
    ...extraHeaders,
  };

  if (etagMatches(req.headers['if-none-match'], etag)) {
    send(res, 304, { ETag: etag, 'Cache-Control': cache });
    return;
  }

  // Range support — without it, seeking in the loader video breaks.
  const rangeHeader = req.headers.range;
  if (rangeHeader) {
    const range = parseRange(rangeHeader, stat.size);
    if (range === 'unsatisfiable') {
      send(res, 416, { ...base, 'Content-Range': `bytes */${stat.size}` });
      return;
    }
    if (range !== 'invalid') {
      const { start, end } = range;
      res.writeHead(206, {
        ...SECURITY_HEADERS,
        ...base,
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Content-Length': end - start + 1,
      });
      if (req.method === 'HEAD') {
        res.end();
        return;
      }
      const stream = createReadStream(filePath, { start, end });
      stream.on('error', () => res.destroy());
      stream.pipe(res);
      return;
    }
  }

  /* Ranges are byte offsets into the *identity* body, so a gzipped
     response must not advertise them. Videos are the only thing that
     needs ranges here and they are never compressible, so the two paths
     never collide. */
  if (COMPRESSIBLE.has(ext) && acceptsGzip(req) && stat.size > 512) {
    const raw = await fsp.readFile(filePath);
    const gz = gzipCached(filePath + ':' + stat.mtimeMs, raw);
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      ...base,
      'Accept-Ranges': 'none',
      'Content-Encoding': 'gzip',
      Vary: 'Accept-Encoding',
      'Content-Length': gz.length,
    });
    if (req.method === 'HEAD') { res.end(); return; }
    res.end(gz);
    return;
  }

  res.writeHead(200, { ...SECURITY_HEADERS, ...base, 'Content-Length': stat.size });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  const stream = createReadStream(filePath);
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}

/* ================================================================ API bits == */

function requireSession(req, res) {
  const cookies = parseCookies(req.headers.cookie);
  if (!sessionValid(cookies[SESSION_COOKIE])) {
    sendJson(res, 401, { error: 'unauthorised' });
    return false;
  }
  return true;
}

function sessionCookie(req, token, maxAgeSec) {
  const secure = TRUST_PROXY && req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAgeSec}${secure}`;
}

function reservationJson(row) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    phone: row.phone,
    party_size: row.party_size,
    slot_at: row.slot_at,
    time: row.slot_at.slice(11, 16),
    status: row.status,
    note: row.note,
    source: row.source,
    created_at: row.created_at,
  };
}

/* -------------------------------------------------------- POST /api/menu --- */

function handleMenu(req, res) {
  const menu = getMenuResponse();
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    ETag: menu.etag,
    'Cache-Control': 'public, max-age=60',
    Vary: 'Accept-Encoding',
  };
  if (etagMatches(req.headers['if-none-match'], menu.etag)) {
    send(res, 304, headers);
    return;
  }
  if (acceptsGzip(req)) {
    const gz = gzipCached('menu:' + menu.etag, menu.body);
    send(res, 200, {
      ...headers,
      'Content-Encoding': 'gzip',
      'Content-Length': gz.length,
    }, req.method === 'HEAD' ? undefined : gz);
    return;
  }
  send(res, 200, { ...headers, 'Content-Length': menu.body.length },
    req.method === 'HEAD' ? undefined : menu.body);
}

/* ------------------------------------------------ POST /api/reservations --- */

async function handleCreateReservation(req, res, ip) {
  if (!guardWrite('reservations', ip, res)) return undefined;
  if (!originOk(req)) return sendJson(res, 403, { error: 'bad_origin' });
  if (!jsonRequestOk(req)) return sendJson(res, 415, { error: 'expected_json' });

  const body = await readJson(req, res);
  if (body === undefined) return undefined;

  const name = validateName(body.name);
  if (name.error) return badRequest(res, name.error, 'name');

  const phone = validatePhone(body.phone);
  if (phone.error) return badRequest(res, phone.error, 'phone');

  const party = validatePartySize(body.party_size);
  if (party.error) return badRequest(res, party.error, 'party_size');

  const slot = validateSlot(body.slot_at);
  if (slot.error) return badRequest(res, slot.error, 'slot_at');

  const note = validateNote(body.note);
  if (note.error) return badRequest(res, note.error, 'note');

  const row = createReservation({
    name: name.value,
    phone: phone.value,
    party_size: party.value,
    slot_at: slot.value,
    note: note.value,
    source: 'web',
  });
  recordWrite('reservations', ip);

  return sendJson(res, 201, {
    code: row.code,
    status: row.status,
    slot_at: row.slot_at,
    party_size: row.party_size,
    name: row.name,
  });
}

/* ------------------------------------------------------ POST /api/orders --- */

async function handleCreateOrder(req, res, ip) {
  if (!guardWrite('orders', ip, res)) return undefined;
  if (!originOk(req)) return sendJson(res, 403, { error: 'bad_origin' });
  if (!jsonRequestOk(req)) return sendJson(res, 415, { error: 'expected_json' });

  const body = await readJson(req, res);
  if (body === undefined) return undefined;

  const phone = validatePhone(body.phone);
  if (phone.error) return badRequest(res, phone.error, 'phone');

  if (!Array.isArray(body.items) || body.items.length === 0) {
    return badRequest(res, 'items_required', 'items');
  }
  if (body.items.length > 100) return badRequest(res, 'too_many_items', 'items');

  // Merge repeats of the same id so one item can't appear twice on the ticket.
  const merged = new Map();
  for (const entry of body.items) {
    if (!entry || typeof entry !== 'object') return badRequest(res, 'item_invalid', 'items');
    const id = typeof entry.id === 'string' ? Number(entry.id) : entry.id;
    const qty = typeof entry.qty === 'string' ? Number(entry.qty) : entry.qty;
    if (!Number.isInteger(id) || id <= 0) return badRequest(res, 'item_id_invalid', 'items');
    if (!Number.isInteger(qty) || qty < 1) return badRequest(res, 'item_qty_invalid', 'items');
    if (qty > 50) return badRequest(res, 'item_qty_too_large', 'items');
    const next = (merged.get(id) || 0) + qty;
    if (next > 50) return badRequest(res, 'item_qty_too_large', 'items');
    merged.set(id, next);
  }

  const lines = [...merged].map(([id, qty]) => ({ id, qty }));

  let result;
  try {
    // Every price below comes from the DB. Anything price-shaped in the request is ignored.
    result = createOrder({ phone: phone.value, lines });
  } catch (err) {
    if (err.kind === 'unknown') {
      return sendJson(res, 400, { error: 'unknown_item', field: 'items', ids: err.ids });
    }
    if (err.kind === 'unavailable') {
      return sendJson(res, 409, { error: 'unavailable', items: err.items });
    }
    throw err;
  }
  recordWrite('orders', ip);

  return sendJson(res, 201, {
    code: result.order.code,
    total: paiseToRupees(result.order.total_paise),
    items: result.items,
  });
}

/* ------------------------------------------------------------- admin API --- */

async function handleAdminLogin(req, res, ip) {
  const limit = rateLimit(`login:${ip}`, 10, 15 * 60 * 1000);
  if (!limit.ok) return tooMany(res, limit.retryAfter);
  if (!originOk(req)) return sendJson(res, 403, { error: 'bad_origin' });
  if (!jsonRequestOk(req)) return sendJson(res, 415, { error: 'expected_json' });

  const body = await readJson(req, res);
  if (body === undefined) return undefined;

  if (!passwordMatches(body.password)) {
    return sendJson(res, 401, { error: 'invalid_password' });
  }
  const { token, expiresAt } = newSession();
  return sendJson(res, 200, { ok: true, expires_at: new Date(expiresAt).toISOString() }, {
    'Set-Cookie': sessionCookie(req, token, Math.floor(SESSION_TTL_MS / 1000)),
  });
}

function handleAdminLogout(req, res) {
  const cookies = parseCookies(req.headers.cookie);
  if (cookies[SESSION_COOKIE]) sessions.delete(cookies[SESSION_COOKIE]);
  return sendJson(res, 200, { ok: true }, {
    'Set-Cookie': `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`,
  });
}

function handleAdminReservations(req, res, url) {
  if (!requireSession(req, res)) return undefined;
  const dateParam = url.searchParams.get('date');
  const date = dateParam ? dateParam.trim() : istDateString();
  if (!validDateParam(date)) return badRequest(res, 'date_invalid', 'date');

  const rows = listReservationsOn(date).map(reservationJson);
  const covers = rows
    .filter((r) => r.status !== 'cancelled' && r.status !== 'no_show')
    .reduce((sum, r) => sum + r.party_size, 0);

  return sendJson(res, 200, { date, count: rows.length, covers, reservations: rows });
}

async function handleAdminPatchReservation(req, res, id) {
  if (!requireSession(req, res)) return undefined;
  if (!originOk(req)) return sendJson(res, 403, { error: 'bad_origin' });
  if (!jsonRequestOk(req)) return sendJson(res, 415, { error: 'expected_json' });

  const body = await readJson(req, res);
  if (body === undefined) return undefined;

  if (!RESERVATION_STATUSES.includes(body.status)) {
    return badRequest(res, 'status_invalid', 'status');
  }
  const row = setReservationStatus(id, body.status);
  if (!row) return sendJson(res, 404, { error: 'not_found' });
  return sendJson(res, 200, reservationJson(row));
}

async function handleAdminPatchItem(req, res, id) {
  if (!requireSession(req, res)) return undefined;
  if (!originOk(req)) return sendJson(res, 403, { error: 'bad_origin' });
  if (!jsonRequestOk(req)) return sendJson(res, 415, { error: 'expected_json' });

  const body = await readJson(req, res);
  if (body === undefined) return undefined;

  const patch = {};
  if (body.price !== undefined) {
    const price = typeof body.price === 'string' ? Number(body.price) : body.price;
    if (typeof price !== 'number' || !Number.isFinite(price) || !Number.isInteger(price)) {
      return badRequest(res, 'price_invalid', 'price');
    }
    if (price < 0 || price > 1_000_000) return badRequest(res, 'price_out_of_range', 'price');
    patch.pricePaise = rupeesToPaise(price);
  }
  if (body.available !== undefined) {
    if (typeof body.available !== 'boolean') return badRequest(res, 'available_invalid', 'available');
    patch.available = body.available;
  }
  if (patch.pricePaise === undefined && patch.available === undefined) {
    return badRequest(res, 'nothing_to_update', 'price');
  }

  const row = updateMenuItem(id, patch);
  if (!row) return sendJson(res, 404, { error: 'not_found' });
  invalidateMenuCache();
  return sendJson(res, 200, publicItem(row));
}

/* ================================================================= router == */

const server = createServer(async (req, res) => {
  const ip = clientIp(req);
  let url;
  try {
    url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  } catch {
    return badRequest(res, 'bad_url');
  }
  const path = url.pathname;
  const method = req.method || 'GET';

  try {
    /* ---- API ---- */
    if (path === '/api/health' && (method === 'GET' || method === 'HEAD')) {
      return sendJson(res, 200, {
        ok: true,
        items: countMenuItems(),
        reservationsToday: countReservationsOn(istDateString()),
      });
    }

    if (path === '/api/menu' && (method === 'GET' || method === 'HEAD')) {
      return handleMenu(req, res);
    }

    if (path === '/api/reservations' && method === 'POST') {
      return await handleCreateReservation(req, res, ip);
    }

    if (path === '/api/orders' && method === 'POST') {
      return await handleCreateOrder(req, res, ip);
    }

    if (path === '/api/admin/login' && method === 'POST') {
      return await handleAdminLogin(req, res, ip);
    }

    if (path === '/api/admin/logout' && method === 'POST') {
      return handleAdminLogout(req, res);
    }

    if (path === '/api/admin/reservations' && method === 'GET') {
      return handleAdminReservations(req, res, url);
    }

    const resvPatch = /^\/api\/admin\/reservations\/(\d{1,12})$/.exec(path);
    if (resvPatch && method === 'PATCH') {
      return await handleAdminPatchReservation(req, res, Number(resvPatch[1]));
    }

    const itemPatch = /^\/api\/admin\/items\/(\d{1,12})$/.exec(path);
    if (itemPatch && method === 'PATCH') {
      return await handleAdminPatchItem(req, res, Number(itemPatch[1]));
    }

    if (path.startsWith('/api/')) {
      return sendJson(res, path.startsWith('/api/admin/') ? 404 : 404, { error: 'not_found' });
    }

    /* ---- admin page ---- */
    if (path === '/admin' || path === '/admin/' || path === '/admin.html') {
      if (method !== 'GET' && method !== 'HEAD') {
        return send(res, 405, { Allow: 'GET, HEAD' }, 'Method not allowed');
      }
      return await serveFile(req, res, join(SERVER_DIR, 'admin.html'), {
        'Cache-Control': 'no-store',
        'X-Frame-Options': 'DENY',
        'Content-Security-Policy':
          "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
          "img-src 'self' data:; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      });
    }

    /* ---- static site ---- */
    if (method !== 'GET' && method !== 'HEAD') {
      return send(res, 405, { Allow: 'GET, HEAD' }, 'Method not allowed');
    }
    const filePath = resolveStaticPath(path);
    if (!filePath) {
      return send(res, 403, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Forbidden');
    }
    return await serveFile(req, res, filePath);
  } catch (err) {
    console.error(`[error] ${method} ${path}`, err);
    if (!res.writableEnded) sendJson(res, 500, { error: 'server_error' });
    return undefined;
  }
});

server.headersTimeout = 20_000;
server.requestTimeout = 30_000;

server.listen(PORT, () => {
  const menu = getMenuResponse();
  console.log('');
  console.log('  Liquid Sky Family Fine Dine & Bar');
  console.log(`  site   http://localhost:${PORT}/`);
  console.log(`  admin  http://localhost:${PORT}/admin`);
  console.log(`  db     ${DB_PATH}`);
  console.log(`  menu   ${menu ? menuPayload().items.length : 0} items, version ${menu.version}`);
  if (GENERATED_PASSWORD) {
    console.log('');
    console.log('  ADMIN_PASSWORD was not set, so one was generated for this run only:');
    console.log('');
    console.log(`      ${ADMIN_PASSWORD}`);
    console.log('');
    console.log('  Set ADMIN_PASSWORD in the environment to keep a stable password.');
  }
  console.log('');
});

function shutdown(signal) {
  console.log(`\n${signal} — shutting down`);
  server.close(() => {
    closeDb();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

export { server };
