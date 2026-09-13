'use strict';

/**
 * Test dishes are chosen by what they ARE — which counter cooks them and
 * how long they take — never by name.
 *
 * The suite used to name specific dishes off one restaurant's card. That
 * is a fixture coupled to the menu: it broke the moment this system was
 * pointed at a different restaurant, and it would break again the first
 * time the kitchen renamed something. What these tests actually care
 * about is "three different stations" and "the slowest one", so that is
 * what they now ask for.
 */

/** Dishes from `n` distinct stations, cheapest path to a multi-station order. */
function distinctStations(items, n) {
  const seen = new Set();
  const out = [];
  for (const i of items) {
    if (!(i.price > 0) || seen.has(i.station)) continue;
    seen.add(i.station);
    out.push(i);
    if (out.length === n) break;
  }
  if (out.length < n) {
    throw new Error(`needed ${n} stations on the menu, found ${out.length}`);
  }
  return out;
}

/** The same, ordered fastest station first — for "is it ready yet" tests. */
function stationsBySpeed(items, n) {
  return distinctStations(items, n).sort((a, b) => a.prep_minutes - b.prep_minutes);
}

/** Any real, priced dish. For tests that just need something orderable. */
function anyDish(items, pred) {
  const hit = items.find((i) => i.price > 0 && (!pred || pred(i)));
  if (!hit) throw new Error('no orderable dish matched');
  return hit;
}

module.exports = { distinctStations, stationsBySpeed, anyDish };
