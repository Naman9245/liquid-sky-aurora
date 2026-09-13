'use strict';

/**
 * Seeds the menu and floor plan for Liquid Sky.
 *
 * The menu itself lives in ./menu-data.js, transcribed from the restaurant's
 * own menu board. Prices there are as printed. What is ours, and therefore
 * worth checking, is the kitchen station and the prep time on each dish —
 * those drive ticket routing and the "ready in 10 min" filter, and the kitchen
 * is the authority on both.
 *
 * Edit in /admin, or edit menu-data.js and run `npm run reseed`.
 */

const crypto = require('crypto');
const { db } = require('./db');
const servicePoints = require('./services/servicePointService');
const auth = require('./services/authService');
const i18n = require('./i18n');

const force = process.argv.includes('--force');

const { CATEGORIES, ITEMS } = require('./menu-data');

// Reflects how the restaurant actually operates: ground floor, rooftop,
// drive-through, takeaway counter, and the attached hotel's rooms.
const SERVICE_POINTS = [
  // The room the reviews actually describe: an air-conditioned hall
  // downstairs and the open-air rooftop above it, plus the bar counter.
  // No drive-thru and no hotel rooms — this restaurant has neither.
  ...Array.from({ length: 10 }, (_, i) => ({ label: `Table ${i + 1}`,   kind: 'TABLE',   zone: 'AC hall' })),
  ...Array.from({ length: 8 },  (_, i) => ({ label: `Rooftop ${i + 1}`, kind: 'ROOFTOP', zone: 'Rooftop' })),
  ...Array.from({ length: 4 },  (_, i) => ({ label: `Bar ${i + 1}`,     kind: 'COUNTER', zone: 'Bar' })),
  { label: 'Takeaway Counter', kind: 'COUNTER', zone: 'Ground floor' },
];

/*
 * No serving-time windows are seeded. The menu board says 24 HOURS SERVICE and
 * puts no hours against any section, so inventing one would be us deciding when
 * the kitchen stops cooking. The feature is there if the restaurant wants it —
 * set a window per dish in /admin.
 */

function alreadySeeded() {
  return db.prepare('SELECT COUNT(*) AS n FROM menu_items').get().n > 0;
}

function wipe() {
  db.exec(`
    DELETE FROM order_items; DELETE FROM orders; DELETE FROM event_log;
    DELETE FROM menu_availability; DELETE FROM menu_items;
    DELETE FROM menu_categories; DELETE FROM service_points;
    DELETE FROM sessions; DELETE FROM staff;
    DELETE FROM sqlite_sequence;
  `);
}

/**
 * PINs are generated, never hard-coded. A default PIN that ships with the code
 * is a default PIN that is still in place a year later. They are printed once,
 * here, and stored only as a scrypt hash — so if they are lost the fix is
 * `npm run set-pin`, not a database dig.
 */
function seedStaff() {
  if (db.prepare('SELECT COUNT(*) n FROM staff').get().n > 0) return null;

  const used = new Set();
  const freshPin = () => {
    let pin;
    do { pin = String(crypto.randomInt(1000, 10000)); } while (used.has(pin));
    used.add(pin);
    return pin;
  };

  const people = [
    { name: 'Manager', role: 'MANAGER' },
    { name: 'Kitchen', role: 'KITCHEN' },
  ];
  return people.map((p) => {
    const pin = freshPin();
    auth.createStaff({ ...p, pin });
    return { ...p, pin };
  });
}

function seed() {
  if (alreadySeeded() && !force) {
    console.log('\n  Database already has a menu — nothing to do.');
    console.log('  Run "npm run reseed" to wipe it and start over.\n');
    const staff = seedStaff();   // covers upgrading a Phase 0 database in place
    if (staff) printStaff(staff);
    printSlugs();
    return;
  }
  if (force) wipe();

  const insertCategory = db.prepare(
    'INSERT INTO menu_categories (name, name_hi, name_kn, sort_order) VALUES (?, ?, ?, ?)'
  );
  const insertItem = db.prepare(`
    INSERT INTO menu_items
      (category_id, name, name_hi, name_kn, description, price, diet_type, station,
       prep_minutes, spice_level, is_signature, is_available, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
  `);

  const run = db.transaction(() => {
    const idByKey = {};
    for (const c of CATEGORIES) {
      idByKey[c.key] = Number(insertCategory.run(
        c.name,
        c.name_hi || i18n.translateName(c.name, 'hi'),
        i18n.translateName(c.name, 'kn'),
        c.sort_order,
      ).lastInsertRowid);
    }
    ITEMS.forEach(([catKey, name, desc, price, diet, station, prep, spice, sig], index) => {
      insertItem.run(idByKey[catKey], name,
        i18n.translateName(name, 'hi'), i18n.translateName(name, 'kn'),
        desc || null, price, diet, station, prep, spice, sig, index);
    });
  });
  run();

  for (const sp of SERVICE_POINTS) servicePoints.create(sp);
  const staff = seedStaff();

  console.log(`\n  Seeded ${CATEGORIES.length} categories, ${ITEMS.length} dishes, ${SERVICE_POINTS.length} service points.`);
  console.log('  The kitchen runs 11:00 to 00:30. Nothing here is time-limited by\n  default — set a serving window per dish in /admin if the bar or the\n  tandoor should stop earlier than the rest.');
  if (staff) printStaff(staff);
  console.log('  Stations and prep times are our estimates, not the kitchen\'s — fix them in /admin.');
  console.log('  Spot-check them against the current board — a menu photo can go out of date.\n');
  printSlugs();
}

function printStaff(staff) {
  console.log('\n  ' + '='.repeat(58));
  console.log('   STAFF PINs — write these down now. They are not shown again.');
  console.log('  ' + '='.repeat(58));
  for (const s of staff) {
    console.log(`   ${s.role.padEnd(9)} ${s.name.padEnd(10)} PIN  ${s.pin}`);
  }
  console.log('  ' + '='.repeat(58));
  console.log('   Change them in /admin -> Staff. Lost one? npm run set-pin\n');
}

function printSlugs() {
  const base = process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
  const points = servicePoints.list().slice(0, 4);
  console.log('  Try these customer links:');
  for (const p of points) console.log(`    ${p.label.padEnd(18)} ${base}${p.path}`);
  console.log(`\n  Kitchen  ${base}/kitchen`);
  console.log(`  Admin    ${base}/admin\n`);
}

seed();
