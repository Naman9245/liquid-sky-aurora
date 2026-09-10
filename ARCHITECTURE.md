# Architecture — Aurora

How this site is put together, and why.

---

## 1. Shape

```
        index.html
        ├── menu-data.js      287 items, 11 KB, [name, category, price, isVeg]
        ├── assets/sky.js     WebGL fragment shader, time-of-day driven
        ├── assets/app.css
        └── assets/app.js     menu · search · cart · chat · reveals · loader
                    │
                    │  fetch, best-effort
                    ▼
        server/server.mjs     node:http, zero dependencies
        ├── /api/menu         live prices + availability
        ├── /api/reservations
        ├── /api/orders
        ├── /api/admin/*      session-gated
        └── /admin            owner's counter, phone-sized
                    │
                    ▼
        server/db.mjs → node:sqlite → server/data/liquid-sky.db
```

There is no build step and no bundler. The page loads three files.

---

## 2. Progressive enhancement, seriously meant

**The site must never be worse because a server is missing.** Every
server-dependent feature is an upgrade over a working baseline, never a
prerequisite.

`liveMenu()` fetches `/api/menu` *after* the baked-in menu is already
painted, so nothing waits on the network. Failure is caught and discarded,
leaving the 287 baked items exactly as they were. On a static host this
costs precisely one 404 per page load — the price of the menu upgrading
itself automatically wherever a server does exist.

The same rule governs bookings: the API is tried first, and any failure
that is not the guest's own input falls straight back to the WhatsApp
hand-off rather than making them retype anything.

---

## 3. Order flow

```
  browser                     server                    sqlite
     │  POST /api/orders         │                         │
     │  { phone, [{id, qty}] }   │                         │
     │ ─────────────────────────►│                         │
     │                           │  look up each id ──────►│
     │                           │◄──── price, available ──│
     │                           │  any unavailable?       │
     │◄──── 409 + item names ────│  yes                    │
     │                           │  no: recompute total    │
     │                           │  insert order + lines ─►│
     │◄──── 201 code, total ─────│  (snapshot unit price)  │
```

The client's cart total is never trusted — a cart is editable in devtools.
The server recomputes from the database and its answer is authoritative; a
request carrying a forged `"price": 1` is ignored.

On a 409 the page reconciles rather than erroring: it drops the sold-out
lines from the cart, marks them on the menu, and tells the guest what went.

---

## 4. Data model

```
categories ──< menu_items ──< order_items >── orders

reservations        settings
```

Two rules that matter more than they look:

**Money is integer paise.** `price_paise INT`, never a float. ₹380 is
`38000`. Floating-point money eventually produces a ₹379.99 bill.

**Order lines snapshot the price.** `order_items.unit_price_paise` is copied
at order time, not joined at read time, so raising a price tomorrow cannot
rewrite yesterday's receipts.

`is_available` is the highest-value column here. One toggle on the owner's
phone and the dish greys out live for every guest.

Seeding is idempotent: re-running `seed.mjs` inserts nothing that exists and
does not clobber prices or availability the owner has already changed.

---

## 5. Security posture

- **Admin auth** — password from `ADMIN_PASSWORD`, compared with
  `timingSafeEqual` over hashes so lengths always match. No default: unset
  means a random password per run, printed once.
- **Sessions** — 32-byte random token in an in-memory Map, 12h expiry,
  `HttpOnly; SameSite=Strict`. Not a JWT, no dependency.
- **Rate limits** — 5 reservations, 10 orders per IP per 10 min; 10 login
  attempts per 15 min; 429 with `Retry-After`. Counted on success with a
  looser attempt cap behind, so five phone-number typos do not lock a guest
  out for ten minutes.
- **Body cap** 32 KB → 413.
- **Path traversal** — resolved and verified to stay inside the site root.
- **Headers** — `nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`,
  and deliberately no permissive CORS.
- Parameterised SQL only.

---

## 6. Performance decisions

- **Text is gzipped** (`node:zlib`, built in): 194 KB → 55 KB across
  HTML/CSS/JS/JSON. Images and video are skipped — already compressed, and
  gzipping them burns CPU to make them marginally bigger.
- **Ranges vs gzip.** A gzipped response advertises `Accept-Ranges: none`,
  since ranges are offsets into the identity body. Video is the only thing
  needing ranges and is never compressible, so the two paths never collide.
- **Video loads on intent.** The two menu-filter clips are 2.9 MB together
  and load when the veg/non-veg switch enters view or takes pointer/focus —
  not on a timer, which previously charged every visitor whether they used
  it or not.
- **The sky throttles.** The canvas is fixed to the viewport so it never
  scrolls away. Below the hero it drops to ~20 fps — about a third of the
  GPU work, invisible through a 22 px backdrop blur.
- **The menu revalidates.** It is sent `max-age=60`, but the page requests
  it with `cache: 'no-cache'`. On the default policy the browser answered
  from its own copy and a dish marked sold out stayed orderable for up to a
  minute — exactly the failure the feature exists to prevent. Revalidation
  is nearly free: unchanged returns 304 with no body.
- **Cache busting** — asset URLs carry `?v=<md5>`; run `./bump-assets.sh`
  after editing CSS or JS.

---

## 7. Known gaps

- Not deployed. The canonical URL is a placeholder.
- Every food photograph is synthetic. This is the single biggest thing
  standing between the site and looking real.
- No automated tests. The menu search has broken twice; it deserves some.
- `assets/app.js` is one ~1,000-line file and wants splitting into modules.
- `node:sqlite` is experimental in Node 22, so the Node version matters.
