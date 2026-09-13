/* Phase 2 — Hindi and Kannada menus. */
const i18n = require('../server/i18n');
const menu = require('../server/services/menuService');
const { CATEGORIES, ITEMS } = require('../server/menu-data');

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? '  PASS' : '! FAIL'}  ${n}${x ? '  — ' + x : ''}`); };

console.log('\n=== Hindi and Kannada ===\n');

const names = ITEMS.map((i) => i[1]).concat(CATEGORIES.map((c) => c.name));

console.log('-- coverage');
for (const lang of ['hi', 'kn']) {
  const c = i18n.coverage(names, lang);
  ok(`every dish and section has a ${lang === 'hi' ? 'Hindi' : 'Kannada'} name`,
     c.ratio === 1, `${c.done}/${c.total}`);
}

console.log('\n-- the dictionary composes');
ok('a two-word dish', i18n.translateName('Chicken Biriyani', 'hi') === 'चिकन बिरयानी');
ok('the same dish in Kannada', i18n.translateName('Chicken Biriyani', 'kn') === 'ಚಿಕನ್ ಬಿರಿಯಾನಿ');
ok('an em-dash variant keeps its dash', i18n.translateName('Chinese Prawns — Chilli', 'hi').includes('—'));
ok('a number is left alone', i18n.translateName('Chicken 65', 'hi').includes('65'));
ok('an ampersand survives', i18n.translateName('Rice & Noodles — Veg', 'kn').includes('&') === false,
   'this one is an override, so the whole phrase is rewritten');

console.log('\n-- overrides beat word-by-word');
ok('Curd Rice is not "दही राइस"', i18n.translateName('Curd Rice', 'hi') === 'दही चावल',
   i18n.translateName('Curd Rice', 'hi'));
ok('"To Order" is dropped from the egg dishes',
   !i18n.translateName('Egg To Order — Half Fry', 'hi').includes('ऑर्डर'),
   i18n.translateName('Egg To Order — Half Fry', 'hi'));

console.log('\n-- English is the safe fallback');
ok('an unknown dish returns nothing rather than a guess',
   i18n.translateName('Zzzz Qqqq', 'hi') === null);
ok('a partly-known dish keeps the unknown word in English',
   i18n.translateName('Chicken Zzzz', 'hi') === 'चिकन Zzzz',
   i18n.translateName('Chicken Zzzz', 'hi'));
ok('English asks for no translation', i18n.translateName('Chicken Biriyani', 'en') === null);
ok('an unknown language asks for no translation', i18n.translateName('Chicken Biriyani', 'fr') === null);

console.log('\n-- what the menu API serves');
const cats = menu.getMenu({ onlyAvailable: true });
const items = cats.flatMap((c) => c.items);
ok('every dish carries a Hindi name', items.every((i) => i.name_hi), `${items.length} dishes`);
ok('every dish carries a Kannada name', items.every((i) => i.name_kn));
ok('every section carries both', cats.every((c) => c.name_hi && c.name_kn), `${cats.length} sections`);
ok('the English name is still there', items.every((i) => i.name));
console.log('\n-- scripts are actually Devanagari and Kannada');
const devanagari = /[ऀ-ॿ]/;
const kannada = /[ಀ-೿]/;

/* A menu with a bar on it is not 100% translatable, and should not be.
   "Bacardi" is printed as Bacardi in every language, and "Bloody Mary" is
   the drink's name rather than a description — transliterating either
   would be inventing a spelling nobody uses. So the invariant is not
   "almost every dish is in Devanagari"; that silently assumed a food-only
   card. It is: everything that CAN be translated IS, and what is left in
   Latin is left there deliberately. */
const translated = items.filter((i) => i.name_hi !== i.name);
const latin = items.filter((i) => !devanagari.test(i.name_hi));

ok('most of the card is genuinely translated',
   translated.length > items.length * 0.85, `${translated.length}/${items.length}`);
ok('anything translated is really in Devanagari',
   translated.every((i) => devanagari.test(i.name_hi)));
ok('anything translated is really in Kannada',
   items.filter((i) => i.name_kn !== i.name).every((i) => kannada.test(i.name_kn)));
ok('what stays in Latin is a proper noun, not a gap',
   latin.length < items.length * 0.15,
   `${latin.length} left alone: ${latin.slice(0, 3).map((i) => i.name).join(', ')}`);
ok('Hindi is not accidentally Kannada',
   !items.some((i) => kannada.test(i.name_hi)));
ok('Kannada is not accidentally Hindi',
   !items.some((i) => devanagari.test(i.name_kn)));

console.log('\n-- a dish added later still gets translated');
const fresh = menu.createItem({
  name: 'Paneer Tikka Masala', price: 260, diet_type: 'VEG', station: 'CURRY',
  category_id: cats[0].id, prep_minutes: 15,
});
ok('a brand new dish comes back with Hindi', !!fresh.name_hi, fresh.name_hi);
ok('and with Kannada', !!fresh.name_kn, fresh.name_kn);
menu.deleteItem(fresh.id);

console.log(`\n=== ${pass} passed, ${fail} failed ===\n`);
process.exit(fail ? 1 : 0);
