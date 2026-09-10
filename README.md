# Liquid Sky — Aurora

The dark variant of the website for **Liquid Sky Family Fine Dine and Bar**,
Bettahalsoor, Yelahanka, on the Bengaluru airport corridor.

Glass panels floating on a live WebGL sky that tracks the actual time of day
in Bengaluru. Walnut and amber, graded from the kitchen footage used as the
loading clip.

**No build step.** The page is plain HTML, CSS and JavaScript — open
`index.html` and it works. The Node server is an optional layer on top that
adds live prices, sold-out state, and recorded bookings and orders.

---

## Run it

Static, no server — the full 287-item menu ships inside the page:

```bash
python3 -m http.server 4174
# http://localhost:4174
```

With the backend:

```bash
node --no-warnings server/seed.mjs                      # first run only
ADMIN_PASSWORD='choose-one' node --no-warnings server/server.mjs
```

- Site — <http://localhost:8788>
- Owner's counter — <http://localhost:8788/admin>

**Requires Node 22.5+.** SQLite comes from the built-in `node:sqlite`, so
there are **zero npm dependencies** — no `package.json`, no `node_modules`,
nothing to audit or patch.

---

## What the server adds

The governing rule is that the site must never be *worse* because a server is
missing. Everything below is an upgrade over a working baseline.

| | Server off | Server on |
|---|---|---|
| Menu | 287 items baked into the page | Live prices, sold-out state |
| Booking | WhatsApp hand-off | Recorded row + booking code, then WhatsApp |
| Order | WhatsApp hand-off | Server-priced order + order code |

The admin page is phone-sized on purpose — it is used standing at the
counter. Tonight's bookings with tappable numbers, and a sold-out toggle plus
price edit across all 287 items.

`server/README.md` has the full API contract.

---

## Editing

After changing anything in `assets/`, re-stamp the cache-busting hashes:

```bash
./bump-assets.sh
```

Asset URLs carry `?v=<md5>` so a changed file is re-fetched immediately and
an unchanged one stays cached.

## Backing up

The database is one file:

```bash
cp server/data/liquid-sky.db ~/liquid-sky-backup-$(date +%F).db
```

## Before this goes live

- Replace the placeholder `https://liquidsky.example` domain — it appears in
  the canonical tag, Open Graph tags, JSON-LD and `sitemap.xml`.
- Set a real `ADMIN_PASSWORD`. Unset means a throwaway one is generated per
  run and printed to the console.
- Point `<meta name="chat-api">` at the deployed chat endpoint. It is
  deliberately blank rather than localhost, which would fail for every real
  visitor.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the data model and the reasoning
behind the trade-offs.

---

The light, React-based variant of this site lives in a separate repository:
[liquid-sky-rooftop-lounge](https://github.com/Naman9245/liquid-sky-rooftop-lounge).
Both share one source of truth for the menu — 287 items across 13 categories,
at real prices, in that repository's `src/data/restaurantData.ts`.
