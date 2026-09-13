'use strict';

const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const servicePoints = require('./services/servicePointService');
const auth = require('./services/authService');
const config = require('./config');
config.assistantEnabled = require('./services/assistantService').enabled;
const realtime = require('./realtime');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: false } });

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

app.set('trust proxy', true);
app.use(express.json({ limit: '256kb' }));

// The event-name contract, served to the browser from the same file the server
// uses, so the two can never drift.
app.get('/shared/events.js', (req, res) => {
  res.type('js').sendFile(path.join(__dirname, 'realtime', 'events.js'));
});
app.use('/shared', express.static(path.join(PUBLIC_DIR, 'shared')));

// Routes give the HTTP layer the same broadcasts the socket layer uses.
app.locals.broadcastNewOrder = (result) => realtime.broadcastNewOrder(io, result);
app.locals.broadcastStatusChange = (result) => realtime.broadcastStatusChange(io, result);
app.locals.broadcastMenuChange = (body) => {
  // The assistant caches the menu; a dish that just sold out must not keep
  // being suggested to the next person who asks.
  require('./services/assistantService').invalidate();
  realtime.broadcastMenuChange(io, body);
};

app.use('/api/auth', require('./routes/auth'));
app.use('/api/menu', require('./routes/menu'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/print', require('./routes/print'));
app.use('/api/assistant', require('./routes/assistant'));

// Everything under /api/admin changes the menu, the floor plan or the prices.
app.use('/api/admin', auth.requireStaff('MANAGER'), require('./routes/admin'));

app.get('/api/health', (req, res) => res.json({ ok: true, at: Date.now() }));

// What a customer's phone is allowed to know about this restaurant.
app.get('/api/config', (req, res) => res.json(require('./config').publicConfig()));

/* ------------------------------------------------------------ page routes */

app.use('/login', express.static(path.join(PUBLIC_DIR, 'login')));
app.use('/customer', express.static(path.join(PUBLIC_DIR, 'customer')));

// Staff screens. The guard runs before express.static, or the page would be
// served to anyone who can reach the box.
app.use('/kitchen', auth.requirePage('KITCHEN', 'MANAGER'),
  express.static(path.join(PUBLIC_DIR, 'kitchen')));
app.use('/admin', auth.requirePage('MANAGER'),
  express.static(path.join(PUBLIC_DIR, 'admin')));

// Defect 01: the customer entry point carries a random slug, never a table id.
app.get('/t/:slug', (req, res, next) => {
  const point = servicePoints.getBySlug(req.params.slug);
  if (!point) {
    return res.status(404).type('html').send(notFoundPage());
  }
  res.sendFile(path.join(PUBLIC_DIR, 'customer', 'index.html'));
});

app.get('/api/service-point/:slug', (req, res, next) => {
  const point = servicePoints.getBySlug(req.params.slug);
  if (!point) return next(Object.assign(new Error('Unknown QR code'), { status: 404 }));
  res.json({ service_point: point });
});

/* The public website, served by the same process that runs the ordering
   system and reading the same menu through /api/menu. A price corrected
   on the owner's phone is corrected on the public page too. */
app.use('/site', express.static(path.join(PUBLIC_DIR, 'site')));
app.get('/', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'site', 'index.html'));
});
/* Staff used to arrive through /. Keep them a stable door. */
app.get('/staff', (req, res) => {
  const staff = auth.currentStaff(req);
  if (!staff) return res.redirect('/login');
  res.redirect(staff.role === 'MANAGER' ? '/admin' : '/kitchen');
});

/* -------------------------------------------------------------- errors */

app.use((req, res) => res.status(404).json({ error: 'Not found' }));

app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) console.error('[http]', err);
  res.status(status).json({
    error: status >= 500
      ? 'Something went wrong at our end. Please try again.'
      : err.message,
  });
});

function notFoundPage() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Liquid Sky</title>
<style>:root{color-scheme:dark}body{font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;
margin:0;background:#12150f;color:#e8ece2;text-align:center;padding:24px;line-height:1.6}
h1{font-size:22px;margin:0 0 10px}p{color:#98a296;margin:0;max-width:32ch}</style></head>
<body><div><h1>This code isn't working</h1>
<p>Please ask a member of staff for a menu — they can take your order at the table.</p>
</div></body></html>`;
}

realtime.attach(io);
require('./maintenance').start();

server.listen(PORT, () => {
  const base = process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`;
  console.log(`\n  Liquid Sky ordering — listening on ${base}\n`);
  console.log(`  Kitchen   ${base}/kitchen`);
  console.log(`  Admin     ${base}/admin`);
  console.log(`  Customer  ${base}/t/<qr-slug>   (run "npm run seed" for demo slugs)\n`);
});

module.exports = { app, server, io };
