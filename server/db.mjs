/**
 * Liquid Sky — data layer.
 *
 * Zero dependencies: node:sqlite (built into Node 22, still flagged experimental).
 * Money is stored as INTEGER paise. Never floats, never rupees, in the DB.
 * Every query below is parameterised — no SQL is ever built by string concatenation.
 */

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomInt } from 'node:crypto';

export const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
export const SITE_ROOT = resolve(SERVER_DIR, '..');

/** Default location; LS_DB_PATH lets you point at a copy (staging, restore drills, tests). */
export const DB_PATH = process.env.LS_DB_PATH
  ? resolve(process.env.LS_DB_PATH)
  : join(SERVER_DIR, 'data', 'liquid-sky.db');

mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);

/* ---------------------------------------------------------------- schema -- */

export function initSchema() {
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS categories (
      id         INTEGER PRIMARY KEY,
      slug       TEXT UNIQUE NOT NULL,
      label      TEXT NOT NULL,
      sort_order INT  NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS menu_items (
      id           INTEGER PRIMARY KEY,
      category_id  INT  NOT NULL REFERENCES categories(id),
      name         TEXT NOT NULL,
      price_paise  INT  NOT NULL,
      is_veg       INT  NOT NULL,
      is_available INT  NOT NULL DEFAULT 1,
      sort_order   INT  NOT NULL DEFAULT 0,
      updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS reservations (
      id         INTEGER PRIMARY KEY,
      code       TEXT UNIQUE NOT NULL,
      name       TEXT NOT NULL,
      phone      TEXT NOT NULL,
      party_size INT  NOT NULL,
      slot_at    TEXT NOT NULL,
      status     TEXT NOT NULL DEFAULT 'pending',
      note       TEXT,
      source     TEXT DEFAULT 'web',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS orders (
      id          INTEGER PRIMARY KEY,
      code        TEXT UNIQUE NOT NULL,
      phone       TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'new',
      total_paise INT  NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id               INTEGER PRIMARY KEY,
      order_id         INT  NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      menu_item_id     INT  NOT NULL REFERENCES menu_items(id),
      name_snapshot    TEXT NOT NULL,
      qty              INT  NOT NULL CHECK(qty > 0),
      unit_price_paise INT  NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_reservations_slot_at  ON reservations(slot_at);
    CREATE INDEX IF NOT EXISTS idx_reservations_status   ON reservations(status);
    CREATE INDEX IF NOT EXISTS idx_menu_items_category   ON menu_items(category_id);
    CREATE INDEX IF NOT EXISTS idx_order_items_order     ON order_items(order_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_menu_items_cat_name ON menu_items(category_id, name);
  `);
}

initSchema();

/* ------------------------------------------------------- prepared queries -- */

export const q = {
  countItems: db.prepare(`SELECT COUNT(*) AS n FROM menu_items`),
  countCategories: db.prepare(`SELECT COUNT(*) AS n FROM categories`),

  allCategories: db.prepare(
    `SELECT id, slug, label, sort_order FROM categories ORDER BY sort_order, id`
  ),
  categoryBySlug: db.prepare(`SELECT id, slug, label, sort_order FROM categories WHERE slug = ?`),
  insertCategory: db.prepare(
    `INSERT INTO categories (slug, label, sort_order) VALUES (?, ?, ?)`
  ),
  updateCategory: db.prepare(`UPDATE categories SET label = ?, sort_order = ? WHERE id = ?`),

  allItems: db.prepare(`
    SELECT m.id, m.name, m.price_paise, m.is_veg, m.is_available, m.sort_order, c.slug, c.label
    FROM menu_items m
    JOIN categories c ON c.id = m.category_id
    ORDER BY c.sort_order, m.sort_order, m.id
  `),
  itemById: db.prepare(`
    SELECT m.id, m.name, m.price_paise, m.is_veg, m.is_available, c.slug
    FROM menu_items m
    JOIN categories c ON c.id = m.category_id
    WHERE m.id = ?
  `),
  itemByCatName: db.prepare(
    `SELECT id, price_paise, is_veg, is_available, sort_order FROM menu_items
     WHERE category_id = ? AND name = ?`
  ),
  insertItem: db.prepare(`
    INSERT INTO menu_items (category_id, name, price_paise, is_veg, is_available, sort_order)
    VALUES (?, ?, ?, ?, 1, ?)
  `),
  /** Structural resync only — never touches price_paise or is_available. */
  syncItemMeta: db.prepare(`UPDATE menu_items SET is_veg = ?, sort_order = ? WHERE id = ?`),
  updateItemPrice: db.prepare(
    `UPDATE menu_items SET price_paise = ?, updated_at = datetime('now') WHERE id = ?`
  ),
  updateItemAvailable: db.prepare(
    `UPDATE menu_items SET is_available = ?, updated_at = datetime('now') WHERE id = ?`
  ),

  insertReservation: db.prepare(`
    INSERT INTO reservations (code, name, phone, party_size, slot_at, status, note, source)
    VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
  `),
  reservationById: db.prepare(`
    SELECT id, code, name, phone, party_size, slot_at, status, note, source, created_at
    FROM reservations WHERE id = ?
  `),
  reservationsBetween: db.prepare(`
    SELECT id, code, name, phone, party_size, slot_at, status, note, source, created_at
    FROM reservations
    WHERE slot_at >= ? AND slot_at < ?
    ORDER BY slot_at, id
  `),
  countReservationsBetween: db.prepare(
    `SELECT COUNT(*) AS n FROM reservations WHERE slot_at >= ? AND slot_at < ?`
  ),
  setReservationStatus: db.prepare(`UPDATE reservations SET status = ? WHERE id = ?`),
  reservationCodeExists: db.prepare(`SELECT 1 AS x FROM reservations WHERE code = ?`),

  insertOrder: db.prepare(
    `INSERT INTO orders (code, phone, status, total_paise) VALUES (?, ?, 'new', ?)`
  ),
  insertOrderItem: db.prepare(`
    INSERT INTO order_items (order_id, menu_item_id, name_snapshot, qty, unit_price_paise)
    VALUES (?, ?, ?, ?, ?)
  `),
  orderCodeExists: db.prepare(`SELECT 1 AS x FROM orders WHERE code = ?`),

  getSetting: db.prepare(`SELECT value FROM settings WHERE key = ?`),
  putSetting: db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `),
};

/* ------------------------------------------------------------- time (IST) -- */

/**
 * The restaurant lives in Asia/Kolkata, which has no DST — a fixed +05:30 forever.
 * slot_at is stored as a full ISO instant *expressed in IST*, e.g.
 * "2026-09-11T00:15:00+05:30". That makes the string both a correct instant and
 * lexicographically sortable/rangeable on the local business day, so a 00:15
 * closing-time booking files under the night the owner actually worked it.
 */
export const IST_OFFSET_MIN = 330;
export const IST_SUFFIX = '+05:30';

const p2 = (n) => String(n).padStart(2, '0');

/** Date -> "2026-09-11T00:15:00+05:30" */
export function toIstIso(date) {
  const t = new Date(date.getTime() + IST_OFFSET_MIN * 60_000);
  return (
    `${t.getUTCFullYear()}-${p2(t.getUTCMonth() + 1)}-${p2(t.getUTCDate())}` +
    `T${p2(t.getUTCHours())}:${p2(t.getUTCMinutes())}:${p2(t.getUTCSeconds())}${IST_SUFFIX}`
  );
}

/** Date -> "2026-09-11" (the IST calendar day). */
export function istDateString(date = new Date()) {
  return toIstIso(date).slice(0, 10);
}

/** "2026-09-11" -> ["2026-09-11T00:00:00+05:30", "2026-09-12T00:00:00+05:30"] */
export function istDayBounds(dateStr) {
  const start = `${dateStr}T00:00:00${IST_SUFFIX}`;
  const next = new Date(`${dateStr}T00:00:00${IST_SUFFIX}`);
  next.setUTCDate(next.getUTCDate() + 1);
  return [start, `${istDateString(next)}T00:00:00${IST_SUFFIX}`];
}

/* ------------------------------------------------------------------ codes -- */

/** No O/0/I/1 — these get read out over a noisy phone line. */
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

export function randomCodeBody(len) {
  let out = '';
  for (let i = 0; i < len; i++) out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return out;
}

function freshCode(prefix, exists) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const code = prefix + randomCodeBody(attempt < 40 ? 4 : 6);
    if (!exists.get(code)) return code;
  }
  throw new Error('could not allocate a unique code');
}

/* -------------------------------------------------------------- money ----- */

export const rupeesToPaise = (rupees) => Math.round(rupees * 100);
export const paiseToRupees = (paise) => Math.round(paise / 100);

/* ----------------------------------------------------------------- reads -- */

export function menuPayload() {
  const categories = q.allCategories.all().map((c) => ({
    slug: c.slug,
    label: c.label,
    sort: c.sort_order,
  }));
  const items = q.allItems.all().map((r) => ({
    id: r.id,
    name: r.name,
    category: r.slug,
    price: paiseToRupees(r.price_paise),
    veg: r.is_veg === 1,
    available: r.is_available === 1,
  }));
  return { categories, items };
}

export function publicItem(row) {
  return {
    id: row.id,
    name: row.name,
    category: row.slug,
    price: paiseToRupees(row.price_paise),
    veg: row.is_veg === 1,
    available: row.is_available === 1,
  };
}

export function countMenuItems() {
  return q.countItems.get().n;
}

export function countReservationsOn(dateStr) {
  const [from, to] = istDayBounds(dateStr);
  return q.countReservationsBetween.get(from, to).n;
}

export function listReservationsOn(dateStr) {
  const [from, to] = istDayBounds(dateStr);
  return q.reservationsBetween.all(from, to);
}

/* ---------------------------------------------------------------- writes -- */

const isUniqueViolation = (err) =>
  /UNIQUE constraint failed/i.test(String(err && err.message));

/**
 * @param {{name:string, phone:string, party_size:number, slot_at:string,
 *          note?:string|null, source?:string}} input  already validated
 */
export function createReservation(input) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = freshCode('LS-', q.reservationCodeExists);
    try {
      const res = q.insertReservation.run(
        code,
        input.name,
        input.phone,
        input.party_size,
        input.slot_at,
        input.note ?? null,
        input.source || 'web'
      );
      return q.reservationById.get(Number(res.lastInsertRowid));
    } catch (err) {
      if (isUniqueViolation(err)) continue; // lost a race on the code; try again
      throw err;
    }
  }
  throw new Error('could not create reservation');
}

/**
 * Prices are read from the DB here and nowhere else — a client-sent price is
 * never even looked at. Each line snapshots unit_price_paise so a later price
 * edit can't rewrite history.
 *
 * @param {{phone:string, lines:{id:number, qty:number}[]}} input
 * @returns {{order:object, items:{name:string,qty:number,price:number,line_total:number}[]}}
 */
export function createOrder(input) {
  const resolved = [];
  const unknown = [];
  const unavailable = [];

  for (const line of input.lines) {
    const row = q.itemById.get(line.id);
    if (!row) {
      unknown.push(line.id);
      continue;
    }
    if (row.is_available !== 1) {
      unavailable.push({ id: row.id, name: row.name });
      continue;
    }
    resolved.push({ row, qty: line.qty });
  }

  if (unknown.length) {
    const err = new Error('unknown_item');
    err.kind = 'unknown';
    err.ids = unknown;
    throw err;
  }
  if (unavailable.length) {
    const err = new Error('unavailable');
    err.kind = 'unavailable';
    err.items = unavailable;
    throw err;
  }

  const totalPaise = resolved.reduce((sum, l) => sum + l.row.price_paise * l.qty, 0);

  for (let attempt = 0; attempt < 8; attempt++) {
    const code = freshCode('LS-ORD-', q.orderCodeExists);
    db.exec('BEGIN IMMEDIATE');
    try {
      const res = q.insertOrder.run(code, input.phone, totalPaise);
      const orderId = Number(res.lastInsertRowid);
      for (const l of resolved) {
        q.insertOrderItem.run(orderId, l.row.id, l.row.name, l.qty, l.row.price_paise);
      }
      db.exec('COMMIT');
      return {
        order: { id: orderId, code, phone: input.phone, total_paise: totalPaise },
        items: resolved.map((l) => ({
          name: l.row.name,
          qty: l.qty,
          price: paiseToRupees(l.row.price_paise),
          line_total: paiseToRupees(l.row.price_paise * l.qty),
        })),
      };
    } catch (err) {
      db.exec('ROLLBACK');
      if (isUniqueViolation(err)) continue;
      throw err;
    }
  }
  throw new Error('could not create order');
}

export const RESERVATION_STATUSES = ['confirmed', 'seated', 'no_show', 'cancelled'];

export function setReservationStatus(id, status) {
  const existing = q.reservationById.get(id);
  if (!existing) return null;
  q.setReservationStatus.run(status, id);
  return q.reservationById.get(id);
}

export function updateMenuItem(id, { pricePaise, available }) {
  const existing = q.itemById.get(id);
  if (!existing) return null;
  if (pricePaise !== undefined) q.updateItemPrice.run(pricePaise, id);
  if (available !== undefined) q.updateItemAvailable.run(available ? 1 : 0, id);
  return q.itemById.get(id);
}

export function closeDb() {
  try {
    db.close();
  } catch {
    /* already closed */
  }
}
