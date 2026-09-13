#!/usr/bin/env bash
# Re-stamp ?v=<content hash> on the site's asset URLs in index.html.
cd "$(dirname "$0")"
python3 - <<'PY'
import pathlib, re, hashlib
h = pathlib.Path('index.html'); t = h.read_text()
for rel in ['assets/app.css', 'assets/sky.js', 'assets/app.js', 'menu-data.js']:
    v = hashlib.md5(pathlib.Path(rel).read_bytes()).hexdigest()[:8]
    t = re.sub(r'(["\'])/site/' + re.escape(rel) + r'(\?v=[0-9a-f]+)?\1',
               lambda m, v=v, rel=rel: m.group(1) + '/site/' + rel + '?v=' + v + m.group(1), t)
h.write_text(t)
print('asset versions bumped')
PY
