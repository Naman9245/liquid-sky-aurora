'use strict';

const { db } = require('../db');
const i18n = require('../i18n');

const STATIONS = ['SOUTH_INDIAN', 'TANDOOR', 'CHINESE', 'BIRYANI', 'CURRY', 'BEVERAGE', 'DESSERT'];
const DIET_TYPES = ['VEG', 'EGG', 'NON_VEG'];

const selectItems = db.prepare(`
  SELECT i.*, c.name AS category_name, c.name_hi AS category_hi,
         c.name_kn AS category_kn, c.sort_order AS category_sort
  FROM menu_items i
  JOIN menu_categories c ON c.id = i.category_id
  ORDER BY c.sort_order, c.name, i.sort_order, i.name
`);

const selectCategories = db.prepare('SELECT * FROM menu_categories ORDER BY sort_order, name');
const selectWindows = db.prepare('SELECT * FROM menu_availability ORDER BY menu_item_id, start_time');
const selectWindowsFor = db.prepare('SELECT * FROM menu_availability WHERE menu_item_id = ?');

/* ------------------------------------------------- serving-time windows */

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

function toMinutes(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
}

/**
 * A window with start === end means all day. A window whose end is before its
 * start wraps past midnight, which is how a late-night menu is written
 * (22:00–02:00) — get that wrong and the kitchen serves nothing after 10pm.
 */
function windowMatches(win, date) {
  if (win.day_of_week !== null && win.day_of_week !== date.getDay()) return false;
  const now = date.getHours() * 60 + date.getMinutes();
  const start = toMinutes(win.start_time);
  const end = toMinutes(win.end_time);
  if (start === end) return true;
  return start < end ? (now >= start && now < end) : (now >= start || now < end);
}

/** No windows at all means the dish is on the menu whenever the door is open. */
function servableNow(itemId, windows, date = new Date()) {
  const mine = windows.filter((w) => w.menu_item_id === itemId);
  return mine.length === 0 || mine.some((w) => windowMatches(w, date));
}

function windowsFor(itemId) {
  return selectWindowsFor.all(itemId).map((w) => ({
    id: w.id, day_of_week: w.day_of_week, start_time: w.start_time, end_time: w.end_time,
  }));
}

const insertWindow = db.prepare(`
  INSERT INTO menu_availability (menu_item_id, day_of_week, start_time, end_time)
  VALUES (?, ?, ?, ?)
`);
const deleteWindows = db.prepare('DELETE FROM menu_availability WHERE menu_item_id = ?');

/** Replaces every window on an item. An empty list means "always available". */
function setWindows(itemId, windows) {
  if (!getItem(itemId)) return null;
  const rows = (Array.isArray(windows) ? windows : []).map((w) => {
    if (!HHMM.test(w.start_time) || !HHMM.test(w.end_time)) {
      throw new ValidationError('Times must be written as HH:MM, for example 07:00');
    }
    const day = w.day_of_week === null || w.day_of_week === undefined || w.day_of_week === ''
      ? null : Number(w.day_of_week);
    if (day !== null && (!Number.isInteger(day) || day < 0 || day > 6)) {
      throw new ValidationError('Day must be 0 (Sunday) to 6 (Saturday), or blank for every day');
    }
    return { day, start_time: w.start_time, end_time: w.end_time };
  });

  const run = db.transaction(() => {
    deleteWindows.run(itemId);
    for (const r of rows) insertWindow.run(itemId, r.day, r.start_time, r.end_time);
  });
  run();
  return windowsFor(itemId);
}

/** Full menu grouped by category. `onlyAvailable` is what the customer sees. */
function getMenu({ onlyAvailable = false, at = new Date() } = {}) {
  const rows = selectItems.all();
  const windows = selectWindows.all();
  const items = onlyAvailable
    ? rows.filter((r) => r.is_available && servableNow(r.id, windows, at))
    : rows;
  const byCategory = new Map();

  for (const row of items) {
    if (!byCategory.has(row.category_id)) {
      byCategory.set(row.category_id, {
        id: row.category_id,
        name: row.category_name,
        name_hi: row.category_hi,
        name_kn: row.category_kn,
        sort_order: row.category_sort,
        items: [],
      });
    }
    byCategory.get(row.category_id).items.push(shapeItem(row));
  }
  return [...byCategory.values()];
}

function shapeItem(row) {
  return {
    id: row.id,
    category_id: row.category_id,
    name: row.name,
    // Filled from the dictionary when a dish has no hand-written translation,
    // so a newly added dish is never blank in Hindi or Kannada.
    name_hi: row.name_hi || i18n.translateName(row.name, 'hi'),
    name_kn: row.name_kn || i18n.translateName(row.name, 'kn'),
    description: row.description,
    price: row.price,
    diet_type: row.diet_type,
    station: row.station,
    prep_minutes: row.prep_minutes,
    spice_level: row.spice_level,
    is_signature: !!row.is_signature,
    is_available: !!row.is_available,
    sort_order: row.sort_order,
    windows: windowsFor(row.id),
  };
}

const getItemById = db.prepare('SELECT * FROM menu_items WHERE id = ?');

function getItem(id) {
  const row = getItemById.get(id);
  return row ? shapeItem(row) : null;
}

function listCategories() {
  return selectCategories.all();
}

const insertItem = db.prepare(`
  INSERT INTO menu_items
    (category_id, name, description, price, diet_type, station,
     prep_minutes, spice_level, is_signature, is_available, sort_order)
  VALUES
    (@category_id, @name, @description, @price, @diet_type, @station,
     @prep_minutes, @spice_level, @is_signature, @is_available, @sort_order)
`);

function createItem(input) {
  const data = normaliseItem(input);
  const info = insertItem.run(data);
  return getItem(info.lastInsertRowid);
}

const updateItemStmt = db.prepare(`
  UPDATE menu_items SET
    category_id = @category_id, name = @name, description = @description,
    price = @price, diet_type = @diet_type, station = @station,
    prep_minutes = @prep_minutes, spice_level = @spice_level,
    is_signature = @is_signature, is_available = @is_available,
    sort_order = @sort_order
  WHERE id = @id
`);

function updateItem(id, input) {
  const existing = getItem(id);
  if (!existing) return null;
  const data = normaliseItem({ ...existing, ...input });
  updateItemStmt.run({ ...data, id });
  return getItem(id);
}

const setAvailabilityStmt = db.prepare('UPDATE menu_items SET is_available = ? WHERE id = ?');

function setAvailability(id, isAvailable) {
  if (!getItem(id)) return null;
  setAvailabilityStmt.run(isAvailable ? 1 : 0, id);
  return getItem(id);
}

const deleteItemStmt = db.prepare('DELETE FROM menu_items WHERE id = ?');

/**
 * order_items keeps a name/price snapshot and a nullable FK, so deleting a
 * menu item never damages order history.
 */
function deleteItem(id) {
  return deleteItemStmt.run(id).changes > 0;
}

function normaliseItem(input) {
  const price = Number(input.price);
  if (!input.name || !String(input.name).trim()) throw new ValidationError('Name is required');
  if (!Number.isFinite(price) || price < 0) throw new ValidationError('Price must be a number of ₹0 or more');
  if (!DIET_TYPES.includes(input.diet_type)) throw new ValidationError(`Diet type must be one of ${DIET_TYPES.join(', ')}`);
  if (!STATIONS.includes(input.station)) throw new ValidationError(`Station must be one of ${STATIONS.join(', ')}`);
  const categoryId = Number(input.category_id);
  if (!Number.isInteger(categoryId)) throw new ValidationError('Category is required');

  return {
    category_id: categoryId,
    name: String(input.name).trim(),
    description: input.description ? String(input.description).trim() : null,
    price,
    diet_type: input.diet_type,
    station: input.station,
    prep_minutes: clampInt(input.prep_minutes, 1, 180, 15),
    spice_level: clampInt(input.spice_level, 0, 3, 0),
    is_signature: input.is_signature ? 1 : 0,
    is_available: input.is_available === undefined ? 1 : (input.is_available ? 1 : 0),
    sort_order: clampInt(input.sort_order, 0, 9999, 0),
  };
}

function clampInt(value, min, max, fallback) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

class ValidationError extends Error {
  constructor(message) { super(message); this.name = 'ValidationError'; this.status = 400; }
}

module.exports = {
  getMenu, getItem, listCategories, createItem, updateItem,
  setAvailability, deleteItem, STATIONS, DIET_TYPES, ValidationError,
  setWindows, windowsFor, servableNow, windowMatches, selectWindows,
};
