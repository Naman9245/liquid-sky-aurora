'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'hunger-house.db');

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(DB_PATH);

// WAL lets the kitchen screen read while a customer is writing an order.
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('foreign_keys = ON');

// Timestamps are epoch milliseconds everywhere. Storing text dates means
// deciding on a timezone, and elapsed-time maths on the kitchen screen is
// where that decision comes back to bite.
db.exec(`
CREATE TABLE IF NOT EXISTS service_points (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  label       TEXT    NOT NULL,
  kind        TEXT    NOT NULL DEFAULT 'TABLE'
              CHECK (kind IN ('TABLE','ROOFTOP','ROOM','DRIVE_THRU','COUNTER')),
  zone        TEXT,
  qr_slug     TEXT    NOT NULL UNIQUE,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS menu_categories (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  name_hi     TEXT,
  name_kn     TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS menu_items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id   INTEGER NOT NULL REFERENCES menu_categories(id) ON DELETE RESTRICT,
  name          TEXT    NOT NULL,
  name_hi       TEXT,
  name_kn       TEXT,
  description   TEXT,
  price         REAL    NOT NULL CHECK (price >= 0),
  diet_type     TEXT    NOT NULL DEFAULT 'VEG'
                CHECK (diet_type IN ('VEG','EGG','NON_VEG')),
  station       TEXT    NOT NULL DEFAULT 'CURRY'
                CHECK (station IN ('SOUTH_INDIAN','TANDOOR','CHINESE','BIRYANI',
                                   'CURRY','BEVERAGE','DESSERT','BAR')),
  prep_minutes  INTEGER NOT NULL DEFAULT 15 CHECK (prep_minutes > 0),
  spice_level   INTEGER NOT NULL DEFAULT 0 CHECK (spice_level BETWEEN 0 AND 3),
  is_signature  INTEGER NOT NULL DEFAULT 0,
  is_available  INTEGER NOT NULL DEFAULT 1,
  sort_order    INTEGER NOT NULL DEFAULT 0
);

-- Phase 1 uses these windows to hide dosa at 22:30. Phase 0 creates the table
-- so the column set never has to change; no rows means always available.
CREATE TABLE IF NOT EXISTS menu_availability (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  menu_item_id  INTEGER NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  day_of_week   INTEGER,
  start_time    TEXT NOT NULL,
  end_time      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  service_point_id INTEGER NOT NULL REFERENCES service_points(id),
  client_order_id  TEXT    NOT NULL UNIQUE,
  status           TEXT    NOT NULL DEFAULT 'PLACED'
                   CHECK (status IN ('PLACED','PREPARING','READY','SERVED','CANCELLED')),
  order_type       TEXT    NOT NULL DEFAULT 'DINE_IN'
                   CHECK (order_type IN ('DINE_IN','ROOM_SERVICE','DRIVE_THRU','TAKEAWAY')),
  server_name      TEXT,
  notes            TEXT,
  placed_at        INTEGER NOT NULL,
  ready_at         INTEGER,
  served_at        INTEGER
);

CREATE TABLE IF NOT EXISTS order_items (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id       INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  menu_item_id   INTEGER REFERENCES menu_items(id) ON DELETE SET NULL,
  name_snapshot  TEXT    NOT NULL,
  price_snapshot REAL    NOT NULL,
  station        TEXT    NOT NULL,
  diet_snapshot  TEXT    NOT NULL DEFAULT 'VEG',
  prep_minutes   INTEGER NOT NULL DEFAULT 15,
  quantity       INTEGER NOT NULL CHECK (quantity > 0),
  special_notes  TEXT,
  item_status    TEXT    NOT NULL DEFAULT 'QUEUED'
                 CHECK (item_status IN ('QUEUED','PREPARING','READY','SERVED'))
);

-- One row per order that has been billed. Written once and never updated:
-- this is the tax record, and Rule 46 wants a consecutive series per financial
-- year. Recomputing it from live data would let a later price edit rewrite it.
CREATE TABLE IF NOT EXISTS invoices (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id           INTEGER NOT NULL UNIQUE REFERENCES orders(id),
  invoice_no         TEXT    NOT NULL UNIQUE,
  financial_year     TEXT    NOT NULL,
  serial             INTEGER NOT NULL,
  issued_at          INTEGER NOT NULL,
  gstin              TEXT    NOT NULL,
  legal_name         TEXT    NOT NULL,
  place_of_supply    TEXT,
  taxable_value      REAL    NOT NULL,
  cgst_rate          REAL    NOT NULL,
  cgst_amount        REAL    NOT NULL,
  sgst_rate          REAL    NOT NULL,
  sgst_amount        REAL    NOT NULL,
  round_off          REAL    NOT NULL,
  total              REAL    NOT NULL,
  prices_include_tax INTEGER NOT NULL,
  lines_json         TEXT    NOT NULL,
  UNIQUE (financial_year, serial)
);

CREATE TABLE IF NOT EXISTS staff (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL,
  pin_hash   TEXT    NOT NULL,
  pin_salt   TEXT    NOT NULL,
  role       TEXT    NOT NULL CHECK (role IN ('KITCHEN','MANAGER')),
  is_active  INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT    PRIMARY KEY,
  staff_id   INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

-- Append-only. Every realtime event is written here before it is broadcast,
-- so a kitchen tablet that drops wifi can ask for everything it missed.
CREATE TABLE IF NOT EXISTS event_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  type       TEXT    NOT NULL,
  order_id   INTEGER,
  payload    TEXT    NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_order_items_order   ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_orders_status       ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_placed_at    ON orders(placed_at);
CREATE INDEX IF NOT EXISTS idx_menu_items_category ON menu_items(category_id);
CREATE INDEX IF NOT EXISTS idx_menu_avail_item      ON menu_availability(menu_item_id);
CREATE INDEX IF NOT EXISTS idx_event_log_order     ON event_log(order_id);
CREATE INDEX IF NOT EXISTS idx_event_log_created    ON event_log(created_at);
CREATE INDEX IF NOT EXISTS idx_sessions_staff       ON sessions(staff_id);
CREATE INDEX IF NOT EXISTS idx_invoices_issued      ON invoices(issued_at);
CREATE INDEX IF NOT EXISTS idx_invoices_fy          ON invoices(financial_year, serial);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry      ON sessions(expires_at);
`);

/**
 * CREATE TABLE IF NOT EXISTS does nothing to a table that already exists, so a
 * database created before a column was added never gets it. Add missing columns
 * explicitly. SQLite has no "ADD COLUMN IF NOT EXISTS", hence the check.
 */
function addColumnIfMissing(table, column, definition) {
  const has = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
  if (!has) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  return !has;
}

const migrations = [
  ['menu_items', 'name_hi', 'TEXT'],
  ['menu_items', 'name_kn', 'TEXT'],
];
const applied = migrations.filter(([t, c, d]) => addColumnIfMissing(t, c, d));
if (applied.length) {
  console.log(`  Database upgraded: added ${applied.map(([t, c]) => t + '.' + c).join(', ')}`);
}

const SLUG_ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz'; // no 0/O/1/l/i — these get read off table tents

/**
 * Defect 01: a sequential table id in the URL lets anyone order to any table
 * from the car park. Slugs are random and unguessable instead.
 */
function makeSlug(length = 7) {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += SLUG_ALPHABET[bytes[i] % SLUG_ALPHABET.length];
  return out;
}

function uniqueSlug() {
  const exists = db.prepare('SELECT 1 FROM service_points WHERE qr_slug = ?');
  for (let attempt = 0; attempt < 20; attempt++) {
    const slug = makeSlug();
    if (!exists.get(slug)) return slug;
  }
  throw new Error('Could not generate a unique QR slug after 20 attempts');
}

module.exports = { db, makeSlug, uniqueSlug, DB_PATH };
