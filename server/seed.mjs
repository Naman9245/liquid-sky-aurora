/**
 * Idempotent seed from ../menu-data.js
 *
 * Safe to run after every deploy. It INSERTs anything missing and resyncs
 * structural fields (veg flag, menu order), but it will never touch a price or
 * a sold-out flag the owner has changed from the admin screen — those live in
 * the DB now, not in menu-data.js.
 *
 *   node --no-warnings server/seed.mjs
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createContext, runInContext } from 'node:vm';

import { db, q, SITE_ROOT, DB_PATH, rupeesToPaise } from './db.mjs';

/** Menu order matters — this is the order the printed menu runs in. */
const CATEGORY_LABELS = [
  ['starters', 'Starters'],
  ['tandoor', 'Tandoor'],
  ['soups', 'Soups'],
  ['mains', 'Mains'],
  ['biryani', 'Biryani'],
  ['chinese', 'Chinese'],
  ['coastal', 'Coastal'],
  ['breads', 'Breads'],
  ['sides', 'Sides'],
  ['desserts', 'Desserts'],
  ['mocktails', 'Mocktails'],
  ['cocktails', 'Cocktails'],
  ['spirits', 'Spirits'],
];

const BUSINESS_SETTINGS = [
  ['business_name', 'Liquid Sky Family Fine Dine & Bar'],
  [
    'address',
    '2nd Floor Balaji Complex, Vidya Nagar Cross Road, Jala Hobli, Yelahanka, Bettahalsoor, Bengaluru 562157',
  ],
  ['phone_display', '087927 42988'],
  ['phone_e164', '+918792742988'],
  ['whatsapp', '918792742988'],
  ['hours', 'Open daily, closes 12:30 AM'],
  ['rating', '4.7'],
  ['rating_count', '140'],
  ['timezone', 'Asia/Kolkata'],
];

/** menu-data.js is a browser file: it assigns to `window`. Run it in a vm sandbox. */
function loadMenuData() {
  const file = join(SITE_ROOT, 'menu-data.js');
  const src = readFileSync(file, 'utf8');
  const sandbox = { window: {} };
  createContext(sandbox);
  runInContext(src, sandbox, { filename: file });
  const data = sandbox.window.LS_DATA;
  if (!data || !Array.isArray(data.items)) {
    throw new Error(`${file} did not define window.LS_DATA.items`);
  }
  return data;
}

function seed() {
  const data = loadMenuData();
  const stats = {
    categoriesInserted: 0,
    categoriesUpdated: 0,
    itemsInserted: 0,
    itemsUnchanged: 0,
    itemsResynced: 0,
    settings: 0,
  };

  db.exec('BEGIN IMMEDIATE');
  try {
    /* -- categories ------------------------------------------------------ */
    const catIds = new Map();
    CATEGORY_LABELS.forEach(([slug, label], sortOrder) => {
      const existing = q.categoryBySlug.get(slug);
      if (!existing) {
        const res = q.insertCategory.run(slug, label, sortOrder);
        catIds.set(slug, Number(res.lastInsertRowid));
        stats.categoriesInserted++;
      } else {
        catIds.set(slug, existing.id);
        if (existing.label !== label || existing.sort_order !== sortOrder) {
          q.updateCategory.run(label, sortOrder, existing.id);
          stats.categoriesUpdated++;
        }
      }
    });

    /* -- items ----------------------------------------------------------- */
    const perCategoryOrder = new Map();

    for (const tuple of data.items) {
      const [name, slug, priceRupees, isVeg] = tuple;
      const categoryId = catIds.get(slug);
      if (!categoryId) throw new Error(`unknown category slug "${slug}" for item "${name}"`);

      const sortOrder = perCategoryOrder.get(slug) ?? 0;
      perCategoryOrder.set(slug, sortOrder + 1);

      const veg = isVeg ? 1 : 0;
      const pricePaise = rupeesToPaise(priceRupees);

      const existing = q.itemByCatName.get(categoryId, name);
      if (!existing) {
        q.insertItem.run(categoryId, name, pricePaise, veg, sortOrder);
        stats.itemsInserted++;
        continue;
      }

      // Owner-owned columns (price_paise, is_available) are deliberately left alone.
      if (existing.is_veg !== veg || existing.sort_order !== sortOrder) {
        q.syncItemMeta.run(veg, sortOrder, existing.id);
        stats.itemsResynced++;
      } else {
        stats.itemsUnchanged++;
      }
    }

    /* -- settings -------------------------------------------------------- */
    for (const [key, value] of BUSINESS_SETTINGS) {
      q.putSetting.run(key, value);
      stats.settings++;
    }

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  const totalItems = q.countItems.get().n;
  const totalCategories = q.countCategories.get().n;

  console.log('Liquid Sky — seed');
  console.log(`  db                 ${DB_PATH}`);
  console.log(`  source             ${join(SITE_ROOT, 'menu-data.js')} (${data.items.length} tuples)`);
  console.log('  ---');
  console.log(`  categories inserted ${stats.categoriesInserted}`);
  console.log(`  categories updated  ${stats.categoriesUpdated}`);
  console.log(`  items inserted      ${stats.itemsInserted}`);
  console.log(`  items skipped       ${stats.itemsUnchanged}  (price / sold-out left as the owner set them)`);
  console.log(`  items resynced      ${stats.itemsResynced}  (veg flag or menu order only)`);
  console.log(`  settings upserted   ${stats.settings}`);
  console.log('  ---');
  console.log(`  TOTAL categories    ${totalCategories}`);
  console.log(`  TOTAL menu_items    ${totalItems}`);

  if (totalItems !== data.items.length) {
    console.error(
      `\n  WARNING: menu_items (${totalItems}) != menu-data.js tuples (${data.items.length}).` +
        '\n  Extra rows are items removed from menu-data.js but still in the DB — they are kept on' +
        '\n  purpose so historic orders keep resolving. Mark them sold out in /admin to hide them.'
    );
  }
}

seed();
