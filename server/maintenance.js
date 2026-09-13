'use strict';

const { db } = require('./db');

/**
 * Housekeeping for a restaurant that never closes.
 *
 * Nothing here touches orders — those are the business record and are kept
 * forever. What gets cleared is the working data that only matters for a short
 * window: the replay log a kitchen tablet reads after a wifi drop, and expired
 * sign-in sessions.
 */

const EVENT_LOG_DAYS = Number(process.env.EVENT_LOG_DAYS) || 7;

const pruneEvents = db.prepare('DELETE FROM event_log WHERE created_at < ?');
const pruneSessions = db.prepare('DELETE FROM sessions WHERE expires_at < ?');

function sweep({ quiet = false } = {}) {
  const now = Date.now();

  // A tablet that has been offline for a week is not going to catch up from the
  // log; it re-reads the live board instead. Seven days is already generous.
  const events = pruneEvents.run(now - EVENT_LOG_DAYS * 86400000).changes;
  const sessions = pruneSessions.run(now).changes;

  if (!quiet && (events || sessions)) {
    const bits = [];
    if (events) bits.push(`${events} old event${events > 1 ? 's' : ''}`);
    if (sessions) bits.push(`${sessions} expired session${sessions > 1 ? 's' : ''}`);
    console.log(`  Housekeeping: cleared ${bits.join(' and ')}.`);
  }
  return { events, sessions };
}

/** Runs once at startup, then hourly. Cheap: two indexed deletes. */
function start() {
  sweep();
  const timer = setInterval(() => sweep({ quiet: true }), 60 * 60 * 1000);
  timer.unref();          // never hold the process open just for housekeeping
  return timer;
}

module.exports = { sweep, start, EVENT_LOG_DAYS };
