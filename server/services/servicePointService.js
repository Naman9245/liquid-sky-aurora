'use strict';

const { db, uniqueSlug } = require('../db');
const { ValidationError } = require('./menuService');

const KINDS = ['TABLE', 'ROOFTOP', 'ROOM', 'DRIVE_THRU', 'COUNTER'];

const selectAll = db.prepare(
  'SELECT * FROM service_points ORDER BY is_active DESC, kind, id'
);
const selectById = db.prepare('SELECT * FROM service_points WHERE id = ?');
const selectBySlug = db.prepare(
  'SELECT * FROM service_points WHERE qr_slug = ? AND is_active = 1'
);
const insert = db.prepare(`
  INSERT INTO service_points (label, kind, zone, qr_slug, is_active, created_at)
  VALUES (@label, @kind, @zone, @qr_slug, 1, @created_at)
`);
const update = db.prepare(
  'UPDATE service_points SET label = @label, kind = @kind, zone = @zone WHERE id = @id'
);
const setActive = db.prepare('UPDATE service_points SET is_active = ? WHERE id = ?');
const rotate = db.prepare('UPDATE service_points SET qr_slug = ? WHERE id = ?');

function list() { return selectAll.all().map(shape); }
function get(id) { const r = selectById.get(id); return r ? shape(r) : null; }
function getBySlug(slug) { const r = selectBySlug.get(slug); return r ? shape(r) : null; }

function shape(row) {
  return {
    id: row.id,
    label: row.label,
    kind: row.kind,
    zone: row.zone,
    qr_slug: row.qr_slug,
    is_active: !!row.is_active,
    path: `/t/${row.qr_slug}`,
  };
}

function create({ label, kind = 'TABLE', zone = null }) {
  if (!label || !String(label).trim()) throw new ValidationError('Label is required');
  if (!KINDS.includes(kind)) throw new ValidationError(`Kind must be one of ${KINDS.join(', ')}`);
  const info = insert.run({
    label: String(label).trim(),
    kind,
    zone: zone ? String(zone).trim() : null,
    qr_slug: uniqueSlug(),
    created_at: Date.now(),
  });
  return get(Number(info.lastInsertRowid));
}

function edit(id, input) {
  const existing = get(id);
  if (!existing) return null;
  const kind = input.kind || existing.kind;
  if (!KINDS.includes(kind)) throw new ValidationError(`Kind must be one of ${KINDS.join(', ')}`);
  update.run({
    id,
    label: String(input.label ?? existing.label).trim(),
    kind,
    zone: input.zone !== undefined ? (input.zone ? String(input.zone).trim() : null) : existing.zone,
  });
  return get(id);
}

function deactivate(id, isActive) {
  if (!get(id)) return null;
  setActive.run(isActive ? 1 : 0, id);
  return get(id);
}

/**
 * Issues a fresh slug and invalidates the old one. For when a table tent is
 * photographed and posted somewhere, or a printed sheet goes missing.
 */
function rotateSlug(id) {
  if (!get(id)) return null;
  rotate.run(uniqueSlug(), id);
  return get(id);
}

module.exports = { list, get, getBySlug, create, edit, deactivate, rotateSlug, KINDS };
