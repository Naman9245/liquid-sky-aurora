#!/usr/bin/env node
'use strict';

/**
 * Recovery for a lost PIN. Run on the machine that holds the database:
 *   npm run set-pin -- "Manager" 4821
 *   npm run set-pin -- --list
 */

const auth = require('../server/services/authService');

const args = process.argv.slice(2);

if (args[0] === '--list' || args.length === 0) {
  const staff = auth.listStaff();
  if (!staff.length) {
    console.log('\n  No staff yet. Run "npm run seed" first.\n');
    process.exit(0);
  }
  console.log('\n  Staff on this system:\n');
  for (const s of staff) {
    console.log(`   #${String(s.id).padEnd(3)} ${s.name.padEnd(14)} ${s.role.padEnd(9)} ${s.is_active ? '' : '(disabled)'}`);
  }
  console.log('\n  Set a PIN:  npm run set-pin -- "<name>" <pin>\n');
  process.exit(0);
}

const [name, pin] = args;
if (!name || !pin) {
  console.error('\n  Usage: npm run set-pin -- "<name>" <4-8 digit pin>\n');
  process.exit(1);
}

const match = auth.listStaff().find((s) => s.name.toLowerCase() === String(name).toLowerCase());
if (!match) {
  console.error(`\n  No staff member called "${name}". Run "npm run set-pin -- --list".\n`);
  process.exit(1);
}

try {
  auth.changePin(match.id, pin);
  console.log(`\n  PIN updated for ${match.name} (${match.role}).`);
  console.log('  Any session they had open has been signed out.\n');
} catch (err) {
  console.error(`\n  ${err.message}\n`);
  process.exit(1);
}
