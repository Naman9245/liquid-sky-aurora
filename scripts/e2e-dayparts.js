/* Phase 1 — serving-time windows. Pure unit checks plus a live order attempt. */
const menu = require('../server/services/menuService');
const { db } = require('../server/db');

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? '  PASS' : '! FAIL'}  ${n}${x ? '  — ' + x : ''}`); };
const at = (h, m = 0, day = 3) => { const d = new Date(2026, 8, 9 + (day - 3), h, m); return d; };

console.log('\n=== Serving-time windows ===\n');

const W = (s, e, day = null) => ({ day_of_week: day, start_time: s, end_time: e });

console.log('-- a normal daytime window');
ok('inside the window', menu.windowMatches(W('06:30', '11:30'), at(9)));
ok('before it opens', !menu.windowMatches(W('06:30', '11:30'), at(6)));
ok('exactly at the open', menu.windowMatches(W('06:30', '11:30'), at(6, 30)));
ok('exactly at the close is already shut', !menu.windowMatches(W('06:30', '11:30'), at(11, 30)));
ok('one minute before close', menu.windowMatches(W('06:30', '11:30'), at(11, 29)));
ok('late evening', !menu.windowMatches(W('06:30', '11:30'), at(22, 30)));

console.log('\n-- a window that wraps past midnight (late-night menu)');
ok('late at night', menu.windowMatches(W('22:00', '02:00'), at(23, 30)));
ok('after midnight', menu.windowMatches(W('22:00', '02:00'), at(1)));
ok('mid-afternoon is outside it', !menu.windowMatches(W('22:00', '02:00'), at(15)));
ok('exactly at the close', !menu.windowMatches(W('22:00', '02:00'), at(2)));

console.log('\n-- start equals end means all day');
ok('noon', menu.windowMatches(W('00:00', '00:00'), at(12)));
ok('3am', menu.windowMatches(W('00:00', '00:00'), at(3)));

console.log('\n-- a day-of-week window (Sunday brunch)');
ok('on a Sunday', menu.windowMatches(W('08:00', '12:00', 0), at(10, 0, 0)));
ok('not on a Wednesday', !menu.windowMatches(W('08:00', '12:00', 0), at(10, 0, 3)));

// The restaurant is open 24 hours and its board sets no hours on anything, so
// the seed creates no windows. The suite makes its own rather than depending on
// seed data it should not be coupled to.
console.log('\n-- a window applied to a real dish');
// Any two real dishes: this suite is about serving windows, not about
// which dish the window is on.
const dosa = db.prepare('SELECT id, name FROM menu_items WHERE price > 0 ORDER BY id LIMIT 1').get();
const biry = db.prepare('SELECT id, name FROM menu_items WHERE price > 0 AND id <> ? ORDER BY id DESC LIMIT 1').get(dosa.id);

ok('out of the box every dish is served round the clock',
   menu.servableNow(dosa.id, menu.selectWindows.all(), at(3)));

menu.setWindows(dosa.id, [{ start_time: '06:30', end_time: '11:30', day_of_week: null }]);
const windows = menu.selectWindows.all();
ok('the windowed dish is on at 9am', menu.servableNow(dosa.id, windows, at(9)));
ok('the windowed dish is off at 22:30', !menu.servableNow(dosa.id, windows, at(22, 30)));
ok('a dish with no window stays on', menu.servableNow(biry.id, windows, at(22, 30)));

const morning = menu.getMenu({ onlyAvailable: true, at: at(9) });
const night = menu.getMenu({ onlyAvailable: true, at: at(22, 30) });
const names = (m) => m.flatMap((c) => c.items).map((i) => i.name);
ok('the 9am menu offers the windowed dish', names(morning).includes(dosa.name));
ok('the 22:30 menu does not', !names(night).includes(dosa.name));
ok('the 22:30 menu still offers the unwindowed dish', names(night).includes(biry.name));
ok('only that one dish disappears',
   names(morning).length - names(night).length === 1,
   `${names(morning).length} dishes at 9am, ${names(night).length} at 22:30`);
ok('the owner still sees it', menu.getMenu({ onlyAvailable: false })
   .flatMap((c) => c.items).some((i) => i.name === dosa.name));

menu.setWindows(dosa.id, []);   // leave the menu as we found it
ok('clearing the window puts it back on the late menu',
   menu.servableNow(dosa.id, menu.selectWindows.all(), at(22, 30)));

console.log('\n-- validation');
try { menu.setWindows(dosa.id, [{ start_time: '7:00', end_time: '11:30' }]); ok('a malformed time is refused', false); }
catch (e) { ok('a malformed time is refused', /HH:MM/.test(e.message), e.message); }
try { menu.setWindows(dosa.id, [{ start_time: '07:00', end_time: '11:30', day_of_week: 9 }]); ok('a bad weekday is refused', false); }
catch (e) { ok('a bad weekday is refused', /0 \(Sunday\)/.test(e.message), e.message); }

const restored = menu.setWindows(dosa.id, [{ start_time: '06:30', end_time: '11:30' }]);
ok('windows can be replaced', restored.length === 1 && restored[0].start_time === '06:30');
ok('an empty list clears them', menu.setWindows(dosa.id, []).length === 0);

console.log(`\n=== ${pass} passed, ${fail} failed ===\n`);
process.exit(fail ? 1 : 0);
