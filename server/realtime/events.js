'use strict';

/**
 * Event names shared by the server and all three browser clients.
 * This file is served to the browser as /shared/events.js too, so the
 * contract can never drift between the two sides.
 */
const EVENTS = {
  // client -> server
  JOIN_ORDER:          'join_order',
  JOIN_KITCHEN:        'join_kitchen',
  JOIN_ADMIN:          'join_admin',
  PLACE_ORDER:         'place_order',
  UPDATE_ORDER_STATUS: 'update_order_status',
  UPDATE_ITEM_STATUS:  'update_item_status',
  SYNC_SINCE:          'sync_since',

  // server -> client
  NEW_ORDER:            'new_order',
  ORDER_STATUS_CHANGED: 'order_status_changed',
  MENU_CHANGED:         'menu_changed',
  SYNC_REPLAY:          'sync_replay',
  ORDER_ACCEPTED:       'order_accepted',
  ERROR:                'server_error',
};

const ROOMS = {
  kitchen: 'kitchen',
  admin: 'admin',
  order: (id) => `order:${id}`,
  station: (s) => `station:${s}`,
};

if (typeof module !== 'undefined' && module.exports) module.exports = { EVENTS, ROOMS };
if (typeof window !== 'undefined') { window.EVENTS = EVENTS; window.ROOMS = ROOMS; }
