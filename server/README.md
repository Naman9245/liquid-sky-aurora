# Liquid Sky — server

The website plus a real backend for **Liquid Sky Family Fine Dine & Bar**, Yelahanka,
Bengaluru. Reservations, phone orders and the live menu live in a SQLite file on disk.

**Zero npm dependencies.** No `node_modules`, no build step, no `npm install`. Just Node.

---

## Run it

```bash
# 1. load the menu into the database (safe to re-run any time)
node --no-warnings server/seed.mjs

# 2. start the site + API
ADMIN_PASSWORD='pick-something-long' node --no-warnings server/server.mjs
```

Then:

- site — <http://localhost:8788/>
- owner screen — <http://localhost:8788/admin>

If you leave `ADMIN_PASSWORD` unset the server generates a random password and prints
it once at boot. That is fine for a quick look; set the env var for anything real, or
you get a new password every restart.

### Node version matters

`node:sqlite` is **built into Node 22+ and still marked experimental**. Tested on
**Node v22.22.1**. `--no-warnings` only silences the experimental notice; without it
everything still works, you just get a warning line on stderr. Do not downgrade below
Node 22.5 — `node:sqlite` will not exist and nothing will start.

---

## Environment variables

| Variable | Default | What it does |
| --- | --- | --- |
| `PORT` | `8788` | Listen port. |
| `ADMIN_PASSWORD` | random each boot | Password for `/admin`. Printed once at startup when unset. |
| `TRUST_PROXY` | off | Set to `1` **only** behind a reverse proxy you control. Makes the rate limiter read `X-Forwarded-For` and marks the session cookie `Secure` on HTTPS. Leaving it off is the safe default — a spoofed header would otherwise slip past the rate limiter. |
| `LS_DB_PATH` | `server/data/liquid-sky.db` | Point at a different database file (staging, restore drills). |

---

## Files

| File | What it is |
| --- | --- |
| `db.mjs` | Schema, prepared statements, money/time/code helpers. All SQL lives here. |
| `seed.mjs` | Idempotent load from `../menu-data.js`. |
| `server.mjs` | `node:http` server — static site + API + `/admin`. |
| `admin.html` | The owner's phone screen. Self-contained, no CDN, no webfonts. |
| `data/` | The database. Git-ignored. **This is the thing to back up.** |

---

## Money

Prices are stored as **integer paise** (`price_paise`) — never floats, never rupees.
The JSON API converts to whole rupees on the way out, which is what the existing
front end already expects, so nothing on the site had to change.

Every order line snapshots `unit_price_paise` at the moment the order is placed. Change
a price in `/admin` tomorrow and last night's tickets still show what the guest was
actually quoted.

A price of `0` means "market price — ask". Two spirits are priced that way in the
source menu. They can still be ordered; the line just comes through at ₹0 and the
number gets confirmed on the call-back.

---

## Time

Everything customer-facing is Asia/Kolkata, which has no DST. `slot_at` is stored as a
full ISO instant **expressed in IST**, e.g. `2026-09-11T00:15:00+05:30`. That keeps the
string both correct as an instant and sortable by the local business day — so a 00:15
booking on a night the kitchen closes at 12:30 AM files under the night the staff
actually worked it, not the next morning.

`created_at` columns are SQLite's `datetime('now')`, which is UTC.

---

## API

Same-origin only. There is deliberately **no** `Access-Control-Allow-Origin: *`.
All responses carry `X-Content-Type-Options: nosniff` and
`Referrer-Policy: strict-origin-when-cross-origin`.

### `GET /api/health`

```json
{ "ok": true, "items": 287, "reservationsToday": 3 }
```

### `GET /api/menu`

Sends `ETag` and `Cache-Control: public, max-age=60`. Send the ETag back as
`If-None-Match` and you get a `304`.

```json
{
  "version": "3f9c1a2b7d40",
  "categories": [ { "slug": "starters", "label": "Starters", "sort": 0 } ],
  "items": [
    { "id": 1, "name": "Masala Papad", "category": "starters",
      "price": 75, "veg": true, "available": true }
  ]
}
```

`price` is whole rupees. `version` is a short SHA-256 of the payload; it changes the
moment a price or sold-out flag changes in `/admin`.

### `POST /api/reservations`

```json
{ "name": "Ananya", "phone": "9876543210",
  "party_size": 4, "slot_at": "2026-09-11T20:30", "note": "window table" }
```

Validation — any failure returns `400 {"error": "...", "field": "..."}`:

| Field | Rule |
| --- | --- |
| `name` | 2–80 characters after trimming |
| `phone` | normalises to a 10-digit Indian mobile; accepts `9876543210`, `09876543210`, `+91 98765 43210`, `919876543210`; stored as `+919876543210` |
| `party_size` | integer, 1–20 |
| `slot_at` | ISO datetime, in the future, within 90 days. No offset = IST wall clock. |
| `note` | optional, ≤ 500 characters |

```json
201 { "code": "LS-7K2M", "status": "pending",
      "slot_at": "2026-09-11T20:30:00+05:30", "party_size": 4, "name": "Ananya" }
```

Codes avoid `O/0/I/1` so they survive being read out over a bad phone line, and are
checked for uniqueness against the database.

### `POST /api/orders`

```json
{ "phone": "9876543210", "items": [ { "id": 1, "qty": 2 }, { "id": 14, "qty": 1 } ] }
```

**Every price is recomputed server-side from the database.** A price sent by the client
is ignored outright. Repeats of the same `id` are merged into one line.

- unknown id → `400 {"error":"unknown_item","field":"items","ids":[…]}`
- sold-out item → `409 {"error":"unavailable","items":[{"id":…,"name":"…"}]}`

```json
201 { "code": "LS-ORD-9QX4", "total": 390,
      "items": [ { "name": "Masala Papad", "qty": 2, "price": 75, "line_total": 150 } ] }
```

### Admin

Session is a random 32-byte token in an `HttpOnly; SameSite=Strict; Path=/` cookie,
held in memory for 12 hours. Not a JWT, no dependency. Restarting the server logs
everyone out.

| Endpoint | Notes |
| --- | --- |
| `POST /api/admin/login` | `{"password":"…"}` → sets the cookie. `401` on a wrong password. |
| `POST /api/admin/logout` | Clears it. |
| `GET /api/admin/reservations?date=YYYY-MM-DD` | Auth. Defaults to today (IST). Ordered by `slot_at`. Returns `{date, count, covers, reservations:[…]}`. |
| `PATCH /api/admin/reservations/:id` | Auth. `{"status":"confirmed\|seated\|no_show\|cancelled"}` → the updated reservation. |
| `PATCH /api/admin/items/:id` | Auth. `{"price": 95, "available": false}` (either or both) → the updated item. |
| `GET /admin` | The owner's screen. |

Without a session, every admin endpoint returns `401 {"error":"unauthorised"}`.

---

## Security notes

- The admin password is compared with `crypto.timingSafeEqual` over SHA-256 digests of
  both sides, so the buffers are always the same length and a wrong guess costs the same
  time as a right one. There is no hardcoded default password anywhere.
- **Rate limits, per IP:** 5 reservations / 10 min, 10 orders / 10 min,
  10 login attempts / 15 min. Over the line you get `429` with a `Retry-After` header.
  Reservations and orders count **successful writes**, not attempts, so a guest who
  fat-fingers their phone number four times doesn't lose their booking slot; a much
  looser attempt cap (40 and 60 per 10 min) sits behind it to stop anyone probing
  validation for free. Login counts every attempt, which is the point.
- Request bodies are capped at **32 KB**; anything larger gets `413`.
- Static paths containing `..` or a NUL byte are rejected, the resolved path is verified
  to stay inside the site root, dotfiles are not served, and `server/` — which holds the
  database — is never reachable over HTTP.
- State-changing API calls must be `Content-Type: application/json`, and if the browser
  sends an `Origin` it has to match the host. With `SameSite=Strict` on the cookie that
  covers CSRF.
- `.mp4` and the other media types support HTTP **Range** requests, so seeking in the
  loader video works properly.

---

## Backups

The database is a single file. Stop the server, copy it, done:

```bash
cp server/data/liquid-sky.db ~/backups/liquid-sky-$(date +%F).db
```

To back up **while the server is running**, use SQLite's own backup so you get a
consistent snapshot rather than a torn WAL:

```bash
sqlite3 server/data/liquid-sky.db ".backup '/home/naman/backups/liquid-sky.db'"
```

No `sqlite3` binary on the box? Node can do it with no dependencies:

```bash
node --no-warnings -e "
const {DatabaseSync}=require('node:sqlite');
const db=new DatabaseSync('server/data/liquid-sky.db');
db.exec(\"VACUUM INTO '/home/naman/backups/liquid-sky.db'\");
db.close();
console.log('backed up');
"
```

Journal mode is WAL, so you will also see `-wal` and `-shm` files next to the database.
A plain `cp` of just the `.db` while the server is running can miss recent writes — use
one of the two commands above instead. Restoring is just putting the file back at
`server/data/liquid-sky.db`.

---

## Re-seeding

`seed.mjs` is safe to run after every deploy. It matches on **category slug + item
name**, inserts anything missing, and resyncs only structural fields (veg flag, menu
order). It will **never** overwrite a price or a sold-out flag the owner changed from
`/admin` — those belong to the database now, not to `menu-data.js`.

Items deleted from `menu-data.js` are deliberately *kept* in the database so that old
orders still resolve their `menu_item_id`. Mark them sold out in `/admin` to take them
off the site.
