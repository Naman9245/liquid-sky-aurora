(function () {
  'use strict';
  const MAX = 8;
  let pin = '';
  let busy = false;

  const dots = document.getElementById('dots');
  const err = document.getElementById('err');
  const go = document.getElementById('go');

  function paint() {
    dots.innerHTML = pin.length
      ? Array.from({ length: pin.length }, () => '<i class="on"></i>').join('')
      : '<i></i><i></i><i></i><i></i>';
    go.disabled = busy || pin.length < 4;
  }

  function press(digit) {
    if (busy || pin.length >= MAX) return;
    pin += digit;
    err.hidden = true;
    paint();
    if (pin.length === 4) go.focus();
  }

  async function submit() {
    if (busy || pin.length < 4) return;
    busy = true; paint();
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Sign in failed');

      const next = new URLSearchParams(location.search).get('next');
      const fallback = body.staff.role === 'MANAGER' ? '/admin' : '/kitchen';
      // Only ever bounce to a path on this server, never to an absolute URL.
      location.href = (next && next.startsWith('/') && !next.startsWith('//')) ? next : fallback;
    } catch (e) {
      err.textContent = e.message;
      err.hidden = false;
      pin = ''; busy = false; paint();
    }
  }

  document.querySelectorAll('[data-k]').forEach((b) =>
    b.addEventListener('click', () => press(b.dataset.k)));
  document.getElementById('clear').addEventListener('click', () => {
    pin = ''; err.hidden = true; paint();
  });
  go.addEventListener('click', submit);

  document.addEventListener('keydown', (e) => {
    if (/^\d$/.test(e.key)) press(e.key);
    else if (e.key === 'Backspace') { pin = pin.slice(0, -1); paint(); }
    else if (e.key === 'Enter') submit();
    else if (e.key === 'Escape') { pin = ''; paint(); }
  });

  paint();
})();
