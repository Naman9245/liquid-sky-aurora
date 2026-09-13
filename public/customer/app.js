/* Liquid Sky — customer ordering. Plain JS, no build step. */
(function () {
  'use strict';

  const slug = location.pathname.split('/').filter(Boolean)[1] || '';
  const CART_KEY = `hh:cart:${slug}`;
  const ORDER_KEY = `hh:order:${slug}`;

  /* The screen's own words. Dish names come from the server; these are the
     labels around them. */
  const UI = {
    en: { all: 'All', veg: 'Veg', egg: 'Egg', non: 'Non-veg', quick: 'Ready in 10 min',
          add: 'ADD', note: 'Add a note', noted: 'Note added', editNote: 'Edit note',
          viewOrder: 'View order', yourOrder: 'Your order', total: 'Total',
          place: 'Place order', sending: 'Sending…', known: "What we're known for",
          empty: 'Your order is empty.', nomatch: 'Nothing matches that filter right now.',
          tableNote: 'Anything for the whole table?', payCounter: 'Pay at the counter after your meal.',
          plusTax: 'Taxes are added to this at billing.',
          min: 'min', spicy: 'Spicy', verySpicy: 'Very spicy', signature: 'Signature',
          another: 'Order something else', coming: "What's coming",
          subtotal: 'Subtotal', roundOff: 'Round off', payable: 'To pay' },
    hi: { all: 'सब', veg: 'शाकाहारी', egg: 'अंडा', non: 'मांसाहारी', quick: '10 मिनट में तैयार',
          add: 'जोड़ें', note: 'नोट जोड़ें', noted: 'नोट जोड़ा', editNote: 'नोट बदलें',
          viewOrder: 'ऑर्डर देखें', yourOrder: 'आपका ऑर्डर', total: 'कुल',
          place: 'ऑर्डर करें', sending: 'भेज रहे हैं…', known: 'हमारी खासियत',
          empty: 'आपका ऑर्डर खाली है।', nomatch: 'इस फ़िल्टर में अभी कुछ नहीं है।',
          tableNote: 'पूरी टेबल के लिए कुछ कहना है?', payCounter: 'खाने के बाद काउंटर पर भुगतान करें।',
          plusTax: 'बिल में टैक्स अलग से जुड़ेगा।',
          min: 'मिनट', spicy: 'तीखा', verySpicy: 'बहुत तीखा', signature: 'खास',
          another: 'और कुछ मंगाएँ', coming: 'क्या आ रहा है',
          subtotal: 'उप-योग', roundOff: 'राउंड ऑफ', payable: 'देय राशि' },
    kn: { all: 'ಎಲ್ಲಾ', veg: 'ಸಸ್ಯಾಹಾರಿ', egg: 'ಮೊಟ್ಟೆ', non: 'ಮಾಂಸಾಹಾರಿ', quick: '10 ನಿಮಿಷದಲ್ಲಿ',
          add: 'ಸೇರಿಸಿ', note: 'ಸೂಚನೆ ಸೇರಿಸಿ', noted: 'ಸೂಚನೆ ಸೇರಿಸಲಾಗಿದೆ', editNote: 'ಸೂಚನೆ ಬದಲಿಸಿ',
          viewOrder: 'ಆರ್ಡರ್ ನೋಡಿ', yourOrder: 'ನಿಮ್ಮ ಆರ್ಡರ್', total: 'ಒಟ್ಟು',
          place: 'ಆರ್ಡರ್ ಮಾಡಿ', sending: 'ಕಳುಹಿಸಲಾಗುತ್ತಿದೆ…', known: 'ನಮ್ಮ ವಿಶೇಷ',
          empty: 'ನಿಮ್ಮ ಆರ್ಡರ್ ಖಾಲಿಯಿದೆ.', nomatch: 'ಈ ಫಿಲ್ಟರ್‌ನಲ್ಲಿ ಈಗ ಏನೂ ಇಲ್ಲ.',
          tableNote: 'ಇಡೀ ಟೇಬಲ್‌ಗೆ ಏನಾದರೂ ಹೇಳಬೇಕೆ?', payCounter: 'ಊಟದ ನಂತರ ಕೌಂಟರ್‌ನಲ್ಲಿ ಪಾವತಿಸಿ.',
          plusTax: 'ಬಿಲ್‌ನಲ್ಲಿ ತೆರಿಗೆ ಪ್ರತ್ಯೇಕವಾಗಿ ಸೇರುತ್ತದೆ.',
          min: 'ನಿಮಿಷ', spicy: 'ಖಾರ', verySpicy: 'ತುಂಬಾ ಖಾರ', signature: 'ವಿಶೇಷ',
          another: 'ಇನ್ನೇನಾದರೂ ಬೇಕೆ', coming: 'ಏನು ಬರುತ್ತಿದೆ',
          subtotal: 'ಉಪ-ಮೊತ್ತ', roundOff: 'ರೌಂಡ್ ಆಫ್', payable: 'ಪಾವತಿಸಬೇಕಾದ ಮೊತ್ತ' },
  };

  const LANG_KEY = 'hh:lang';
  const t = (k) => (UI[state.lang] || UI.en)[k] || UI.en[k];

  /** Dish and category names in the chosen language, English if none exists. */
  const nameIn = (obj) => (state.lang === 'en' ? obj.name
    : (state.lang === 'hi' ? obj.name_hi : obj.name_kn) || obj.name);

  const state = {
    servicePoint: null,
    categories: [],
    cart: loadCart(),          // { [menuItemId]: { qty, notes } }
    diet: 'ALL',
    quickOnly: false,
    lang: (() => { try { return localStorage.getItem(LANG_KEY) || 'en'; } catch { return 'en'; } })(),
    order: null,
    config: null,
    socket: null,
  };

  const $ = (id) => document.getElementById(id);
  const els = {
    seat: $('seat'), menu: $('menu'), conn: $('connection'),
    cartbar: $('cartbar'), cartCount: $('cartCount'), cartTotal: $('cartTotal'),
    sheet: $('sheet'), scrim: $('scrim'), cartLines: $('cartLines'),
    sheetTotal: $('sheetTotal'), orderNotes: $('orderNotes'),
    placeOrder: $('placeOrder'), orderError: $('orderError'),
    viewMenu: $('view-menu'), viewStatus: $('view-status'),
    statusTitle: $('statusTitle'), statusSub: $('statusSub'), steps: $('steps'),
    statusItems: $('statusItems'), statusTotal: $('statusTotal'),
    orderNum: $('orderNum'), thanks: $('thanks'), newOrder: $('newOrder'),
    taxRows: $('taxRows'), totalLabel: $('totalLabel'),
    upiBlock: $('upiBlock'), upiQr: $('upiQr'), upiOpen: $('upiOpen'),
    askBox: $('askBox'), askOpen: $('askOpen'), askOpenLabel: $('askOpenLabel'),
    askPanel: $('askPanel'), askForm: $('askForm'), askInput: $('askInput'),
    askSend: $('askSend'), askChips: $('askChips'), askAnswer: $('askAnswer'),
    payNote: $('payNote'), thanksBy: $('thanksBy'), reviewLink: $('reviewLink'),
    quickToggle: $('quickToggle'),
  };

  /* ------------------------------------------------------------- helpers */

  // crypto.randomUUID() is undefined on plain http over a LAN IP — which is
  // exactly how this will be served inside the restaurant.
  function uuid() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    const b = new Uint8Array(16);
    (window.crypto || {}).getRandomValues
      ? window.crypto.getRandomValues(b)
      : b.forEach((_, i) => (b[i] = Math.floor(Math.random() * 256)));
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
  }

  const rupees = (n) => '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 });
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function loadCart() {
    try { return JSON.parse(localStorage.getItem(CART_KEY)) || {}; } catch { return {}; }
  }
  function saveCart() {
    try { localStorage.setItem(CART_KEY, JSON.stringify(state.cart)); } catch {}
  }
  function rememberOrder(id) {
    try { id ? localStorage.setItem(ORDER_KEY, String(id)) : localStorage.removeItem(ORDER_KEY); } catch {}
  }
  function rememberedOrder() {
    try { return Number(localStorage.getItem(ORDER_KEY)) || null; } catch { return null; }
  }

  const allItems = () => state.categories.flatMap((c) => c.items);
  const findItem = (id) => allItems().find((i) => i.id === Number(id));

  /* ---------------------------------------------------------------- boot */

  async function boot() {
    try {
      await loadConfig();
      const [spRes, menuRes] = await Promise.all([
        fetch(`/api/service-point/${encodeURIComponent(slug)}`),
        fetch('/api/menu'),
      ]);
      if (!spRes.ok) throw new Error('bad-slug');
      state.servicePoint = (await spRes.json()).service_point;
      state.categories = (await menuRes.json()).categories;
    } catch {
      els.menu.innerHTML = `<p class="empty">We couldn't load the menu.<br>
        Please check your connection, or ask a member of staff.</p>`;
      return;
    }

    els.seat.textContent = state.servicePoint.label;
    document.querySelectorAll('.lang').forEach((b) =>
      b.classList.toggle('is-on', b.dataset.lang === state.lang));
    applyUiLanguage();
    renderAskChrome();
    pruneCart();
    renderMenu();
    renderCart();
    connect();

    const existing = rememberedOrder();
    if (existing) resumeOrder(existing);
  }

  // A dish that sold out while the tab sat open shouldn't sit in the cart.
  function pruneCart() {
    let changed = false;
    for (const id of Object.keys(state.cart)) {
      if (!findItem(id)) { delete state.cart[id]; changed = true; }
    }
    if (changed) saveCart();
  }

  /* ---------------------------------------------------------- menu render */

  function visibleItems(items) {
    return items.filter((i) => {
      if (state.diet !== 'ALL' && i.diet_type !== state.diet) return false;
      if (state.quickOnly && i.prep_minutes > 10) return false;
      return true;
    });
  }

  /** Labels written into index.html in English, swapped when language changes. */
  function applyUiLanguage() {
    document.documentElement.lang = state.lang;
    const set = (sel, text) => { const n = document.querySelector(sel); if (n) n.textContent = text; };
    set('.chip[data-diet="ALL"]', t('all'));
    document.querySelector('.chip[data-diet="VEG"]').innerHTML = '<i class="dot veg"></i>' + esc(t('veg'));
    document.querySelector('.chip[data-diet="EGG"]').innerHTML = '<i class="dot egg"></i>' + esc(t('egg'));
    document.querySelector('.chip[data-diet="NON_VEG"]').innerHTML = '<i class="dot non"></i>' + esc(t('non'));
    els.quickToggle.innerHTML = '<span aria-hidden="true">⚡</span> ' + esc(t('quick'));
    set('.cartbar-label', t('viewOrder'));
    set('.sheet-head h2', t('yourOrder'));
    set('.totals span', t('total'));
    set('.notes-block span', t('tableNote'));
    set('.sheet-body .paynote', t('payCounter'));
    set('#placeOrder', t('place'));
    set('#newOrder', t('another'));
    set('.receipt h2', t('coming'));
    els.orderNotes.setAttribute('placeholder', t('tableNote'));
  }

  function renderMenu() {
    const signature = visibleItems(allItems().filter((i) => i.is_signature));
    const groups = state.categories
      .map((c) => ({ ...c, items: visibleItems(c.items) }))
      .filter((c) => c.items.length);

    if (!groups.length) {
      els.menu.innerHTML = `<p class="empty">${esc(t('nomatch'))}</p>`;
      return;
    }

    let html = '';
    if (signature.length && state.diet === 'ALL' && !state.quickOnly) {
      html += `<section class="cat"><h2 class="cat-name signature">${esc(t('known'))}</h2>
        ${signature.map(itemHtml).join('')}</section>`;
    }
    html += groups.map((c) => `<section class="cat">
      <h2 class="cat-name">${esc(nameIn(c))}</h2>${c.items.map(itemHtml).join('')}</section>`).join('');
    els.menu.innerHTML = html;
  }

  function itemHtml(item) {
    const line = state.cart[item.id];
    const dietClass = item.diet_type === 'VEG' ? 'veg' : item.diet_type === 'EGG' ? 'egg' : 'non';
    const tags = [];
    tags.push(`<span class="tag ${item.prep_minutes <= 10 ? 'quick' : ''}">${item.prep_minutes} ${t('min')}</span>`);
    if (item.is_signature) tags.push(`<span class="tag sig">${esc(t('signature'))}</span>`);
    if (item.spice_level >= 3) tags.push(`<span class="tag spice">${esc(t('verySpicy'))}</span>`);
    else if (item.spice_level === 2) tags.push(`<span class="tag spice">${esc(t('spicy'))}</span>`);

    const control = line
      ? `<div class="stepper">
           <button type="button" data-act="dec" data-id="${item.id}" aria-label="Remove one ${esc(item.name)}">−</button>
           <span>${line.qty}</span>
           <button type="button" data-act="inc" data-id="${item.id}" aria-label="Add one ${esc(item.name)}">+</button>
         </div>
         <button type="button" class="notebtn ${line.notes ? 'has' : ''}" data-act="note" data-id="${item.id}">
           ${line.notes ? esc(t('noted')) : esc(t('note'))}</button>`
      : `<button type="button" class="addbtn" data-act="add" data-id="${item.id}">${esc(t('add'))}</button>`;

    return `<article class="item">
      <div class="item-main">
        <div class="item-top">
          <i class="dot ${dietClass}" title="${item.diet_type.replace('_', '-').toLowerCase()}"></i>
          <span class="item-name">${esc(nameIn(item))}</span>
        </div>
        ${state.lang !== 'en' && nameIn(item) !== item.name
          ? `<span class="item-en">${esc(item.name)}</span>` : ''}
        ${item.description ? `<p class="item-desc">${esc(item.description)}</p>` : ''}
        <div class="item-meta"><span class="price">${rupees(item.price)}</span>${tags.join('')}</div>
      </div>
      <div class="item-add">${control}</div>
    </article>`;
  }

  /* ------------------------------------------------------------ cart */

  function cartLines() {
    return Object.entries(state.cart).map(([id, line]) => {
      const item = findItem(id);
      return item ? { item, qty: line.qty, notes: line.notes || '' } : null;
    }).filter(Boolean);
  }

  const cartTotal = () => cartLines().reduce((s, l) => s + l.item.price * l.qty, 0);
  const cartCount = () => cartLines().reduce((s, l) => s + l.qty, 0);

  function setQty(id, qty) {
    if (qty <= 0) delete state.cart[id];
    else state.cart[id] = { qty, notes: (state.cart[id] || {}).notes || '' };
    saveCart(); renderMenu(); renderCart();
  }

  function renderCart() {
    const count = cartCount();
    els.cartbar.hidden = count === 0 || !els.viewStatus.hidden;
    els.cartCount.textContent = count;
    els.cartTotal.textContent = rupees(cartTotal());

    const lines = cartLines();
    els.cartLines.innerHTML = lines.length
      ? lines.map((l) => `<div class="line">
          <div class="line-main">
            <div class="line-name">${esc(nameIn(l.item))}</div>
            ${l.notes ? `<div class="line-note">“${esc(l.notes)}”</div>` : ''}
            <button type="button" class="notebtn ${l.notes ? 'has' : ''}" data-act="note" data-id="${l.item.id}">
              ${l.notes ? esc(t('editNote')) : esc(t('note'))}</button>
          </div>
          <div class="stepper">
            <button type="button" data-act="dec" data-id="${l.item.id}" aria-label="Remove one">−</button>
            <span>${l.qty}</span>
            <button type="button" data-act="inc" data-id="${l.item.id}" aria-label="Add one">+</button>
          </div>
          <div class="line-price">${rupees(l.item.price * l.qty)}</div>
        </div>`).join('')
      : `<p class="empty">${esc(t('empty'))}</p>`;
    els.sheetTotal.textContent = rupees(cartTotal());
    const taxNote = document.getElementById('cartTaxNote');
    if (taxNote) {
      const gstOn = state.config && state.config.gst_enabled;
      taxNote.textContent = gstOn ? t('plusTax') : '';
      taxNote.hidden = !gstOn;
    }
    els.placeOrder.disabled = lines.length === 0;
  }

  function openSheet() { els.sheet.hidden = false; els.scrim.hidden = false; els.orderError.hidden = true; }
  function closeSheet() { els.sheet.hidden = true; els.scrim.hidden = true; }

  /* ------------------------------------------------------- place order */

  async function placeOrder() {
    const lines = cartLines();
    if (!lines.length) return;

    els.placeOrder.disabled = true;
    els.placeOrder.textContent = 'Sending…';
    els.orderError.hidden = true;

    // One id per attempt, reused across retries: the server returns the
    // existing order instead of creating a second one.
    const payload = {
      client_order_id: uuid(),
      qr_slug: slug,
      notes: els.orderNotes.value.trim() || null,
      items: lines.map((l) => ({
        menu_item_id: l.item.id,
        quantity: l.qty,
        special_notes: l.notes || null,
      })),
    };

    try {
      const order = await sendOrder(payload);
      state.cart = {}; saveCart();
      els.orderNotes.value = '';
      closeSheet();
      showOrder(order);
      rememberOrder(order.id);
      joinOrderRoom(order.id);
    } catch (err) {
      els.orderError.textContent = err.message ||
        'We could not send your order. Please try again, or ask a member of staff.';
      els.orderError.hidden = false;
    } finally {
      els.placeOrder.disabled = false;
      els.placeOrder.textContent = 'Place order';
    }
  }

  // Socket first (instant), HTTP as the fallback when the socket is down.
  function sendOrder(payload) {
    return new Promise((resolve, reject) => {
      const viaHttp = () => fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || 'Order failed');
        return body.order;
      }).then(resolve, reject);

      if (!state.socket || !state.socket.connected) return viaHttp();

      let settled = false;
      const timer = setTimeout(() => { if (!settled) { settled = true; viaHttp(); } }, 6000);
      state.socket.emit(EVENTS.PLACE_ORDER, payload, (res) => {
        if (settled) return;
        settled = true; clearTimeout(timer);
        if (res && res.ok) resolve(res.order);
        else reject(new Error((res && res.error) || 'Order failed'));
      });
    });
  }



  /* ------------------------------------------------------- menu assistant */

  const ASK_UI = {
    en: { open: 'Not sure what to order? Ask us', ph: 'e.g. something spicy and veg',
          staff: 'We cannot check ingredients from here. Please tell a member of staff about any allergy — they will check with the kitchen.',
          note: 'Suggestions only. Staff and the kitchen have the final word.',
          chips: ['Something spicy and veg', "I'm in a hurry", 'Good for two people', "What's your best dish?"],
          errGeneric: 'We could not get an answer just now. Please ask a member of staff — they know the menu best.',
          errBusy: 'That is a few questions already. Give it a few minutes, or ask a member of staff.' },
    hi: { open: 'क्या मंगाएँ समझ नहीं आ रहा? पूछिए', ph: 'जैसे — कुछ स्पाइसी वेज सजेस्ट करो',
          staff: 'हम यहाँ से सामग्री नहीं देख सकते। किसी भी एलर्जी के बारे में स्टाफ को बताएँ — वे रसोई से पूछ लेंगे।',
          note: 'ये सिर्फ़ सुझाव हैं। अंतिम बात स्टाफ और रसोई की।',
          chips: ['कुछ स्पाइसी वेज', 'जल्दी में हूँ', 'दो लोगों के लिए', 'आपकी सबसे अच्छी डिश?'],
          errGeneric: 'अभी जवाब नहीं मिल पाया। कृपया स्टाफ से पूछें — उन्हें मेन्यू सबसे अच्छी तरह पता है।',
          errBusy: 'आपने कुछ सवाल पूछ लिए हैं। थोड़ी देर बाद कोशिश करें, या स्टाफ से पूछें।' },
    kn: { open: 'ಏನು ಆರ್ಡರ್ ಮಾಡಬೇಕೆಂದು ಗೊತ್ತಿಲ್ಲವೇ? ಕೇಳಿ', ph: 'ಉದಾ — ಖಾರವಾದ ಸಸ್ಯಾಹಾರಿ ಏನಾದರೂ',
          staff: 'ಪದಾರ್ಥಗಳನ್ನು ನಾವು ಇಲ್ಲಿಂದ ಪರಿಶೀಲಿಸಲಾಗುವುದಿಲ್ಲ. ಅಲರ್ಜಿ ಇದ್ದರೆ ಸಿಬ್ಬಂದಿಗೆ ತಿಳಿಸಿ — ಅವರು ಅಡುಗೆಮನೆಯಲ್ಲಿ ಕೇಳುತ್ತಾರೆ.',
          note: 'ಇವು ಸಲಹೆಗಳಷ್ಟೇ. ಅಂತಿಮ ನಿರ್ಧಾರ ಸಿಬ್ಬಂದಿ ಮತ್ತು ಅಡುಗೆಮನೆಯದು.',
          chips: ['ಖಾರವಾದ ಸಸ್ಯಾಹಾರಿ', 'ನಾನು ಅವಸರದಲ್ಲಿದ್ದೇನೆ', 'ಇಬ್ಬರಿಗೆ', 'ನಿಮ್ಮ ಅತ್ಯುತ್ತಮ ಖಾದ್ಯ?'],
          errGeneric: 'ಈಗ ಉತ್ತರ ಸಿಗಲಿಲ್ಲ. ದಯವಿಟ್ಟು ಸಿಬ್ಬಂದಿಯನ್ನು ಕೇಳಿ — ಅವರಿಗೆ ಮೆನು ಚೆನ್ನಾಗಿ ಗೊತ್ತು.',
          errBusy: 'ನೀವು ಈಗಾಗಲೇ ಕೆಲವು ಪ್ರಶ್ನೆ ಕೇಳಿದ್ದೀರಿ. ಸ್ವಲ್ಪ ಸಮಯದ ನಂತರ ಪ್ರಯತ್ನಿಸಿ, ಅಥವಾ ಸಿಬ್ಬಂದಿಯನ್ನು ಕೇಳಿ.' },
  };
  const askUi = () => ASK_UI[state.lang] || ASK_UI.en;

  function renderAskChrome() {
    if (!state.config || !state.config.assistant_enabled) { els.askBox.hidden = true; return; }
    els.askBox.hidden = false;
    els.askOpenLabel.textContent = askUi().open;
    els.askInput.setAttribute('placeholder', askUi().ph);
    els.askChips.innerHTML = askUi().chips
      .map((c) => `<button class="ask-chip" type="button" data-ask="${esc(c)}">${esc(c)}</button>`).join('');
  }

  async function askAssistant(question) {
    if (!question.trim()) return;
    els.askAnswer.hidden = false;
    els.askAnswer.innerHTML = `<p class="ask-reply">${esc(askUi().ph ? '…' : '…')}</p>`;
    els.askSend.disabled = true;

    try {
      const res = await fetch('/api/assistant/ask', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, lang: state.lang, qr_slug: slug }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (body.error) console.warn('[assistant]', res.status, body.error);
        throw new Error(res.status === 429 ? askUi().errBusy : askUi().errGeneric);
      }

      const cards = body.suggestions.map((d) => {
        const name = state.lang === 'hi' ? (d.name_hi || d.name)
          : state.lang === 'kn' ? (d.name_kn || d.name) : d.name;
        const dc = d.diet_type === 'VEG' ? 'veg' : d.diet_type === 'EGG' ? 'egg' : 'non';
        return `<div class="ask-card">
          <div class="ask-card-main">
            <div class="ask-card-name"><i class="dot ${dc}"></i>${esc(name)}</div>
            <div class="ask-card-meta">${rupees(d.price)} · ${d.prep_minutes} ${esc(t('min'))}</div>
          </div>
          <button class="addbtn" style="width:84px" type="button" data-act="add" data-id="${d.id}">${esc(t('add'))}</button>
        </div>`;
      }).join('');

      els.askAnswer.innerHTML = `<p class="ask-reply">${esc(body.reply)}</p>
        ${body.needs_staff ? `<p class="ask-staff">${esc(askUi().staff)}</p>` : ''}
        ${cards ? `<div class="ask-sugg">${cards}</div>` : ''}
        <p class="ask-note">${esc(askUi().note)}</p>`;
    } catch (err) {
      els.askAnswer.innerHTML = `<p class="ask-err">${esc(err.message)}</p>`;
    } finally {
      els.askSend.disabled = false;
    }
  }

  /* ---------------------------------------------------------- bill extras */

  async function loadConfig() {
    try {
      state.config = await (await fetch('/api/config')).json();
    } catch { state.config = { upi_enabled: false, review: { enabled: false } }; }
  }

  /**
   * Both panels are opt-in. With no UPI id configured there is no pay panel at
   * all, and with no review link there is no review button — better than a dead
   * link or, worse, a stranger's UPI address.
   */
  function renderBillExtras(order) {
    const cfg = state.config || {};
    const payable = order.status === 'READY' || order.status === 'SERVED';

    if (cfg.upi_enabled && payable && order.total > 0) {
      const src = `/api/orders/${order.id}/upi-qr.png?slug=${encodeURIComponent(slug)}&v=${order.total}`;
      if (els.upiQr.getAttribute('src') !== src) els.upiQr.setAttribute('src', src);
      els.upiBlock.hidden = false;
      // Fetched rather than built here, so the app link and the QR always
      // encode the same payee and the same amount.
      if (els.upiOpen.dataset.for !== String(order.id) + ':' + order.total) {
        fetch(`/api/orders/${order.id}/upi-link?slug=${encodeURIComponent(slug)}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((body) => {
            if (!body) return;
            els.upiOpen.href = body.link;
            els.upiOpen.dataset.for = String(order.id) + ':' + order.total;
          })
          .catch(() => {});
      }
      els.payNote.textContent = 'Pay by UPI below, or at the counter.';
    } else {
      els.upiBlock.hidden = true;
      els.payNote.textContent = 'Pay at the counter. Please keep this screen for reference.';
    }

    if (order.status === 'SERVED') {
      els.thanksBy.textContent = order.server_name
        ? `Served by ${order.server_name}. If everything was good, a word about them genuinely helps.`
        : 'If everything was good, a quick review genuinely helps our team.';
      els.reviewLink.hidden = !(cfg.review && cfg.review.enabled);
      if (cfg.review && cfg.review.enabled) els.reviewLink.href = cfg.review.url;
      els.thanks.hidden = false;
    } else {
      els.thanks.hidden = true;
    }
  }

  /* ----------------------------------------------------------- tracker */

  const STATUS_COPY = {
    PLACED:    { title: 'Order placed', sub: 'The kitchen has it. We\'ll update this screen as it moves.' },
    PREPARING: { title: 'Being cooked now', sub: 'Your food is on the fire.' },
    READY:     { title: 'Ready', sub: 'Coming to you now.' },
    SERVED:    { title: 'Served', sub: 'Enjoy your meal.' },
    CANCELLED: { title: 'Order cancelled', sub: 'Please speak to a member of staff.' },
  };
  const STEP_ORDER = ['PLACED', 'PREPARING', 'READY', 'SERVED'];

  function showOrder(order) {
    state.order = order;
    els.viewMenu.hidden = true;
    els.viewStatus.hidden = false;
    els.cartbar.hidden = true;
    window.scrollTo(0, 0);
    renderStatus();
  }

  function renderStatus() {
    const o = state.order;
    if (!o) return;
    const copy = STATUS_COPY[o.status] || STATUS_COPY.PLACED;

    els.orderNum.textContent = '#' + o.id;
    els.statusTitle.textContent = copy.title;

    let sub = copy.sub;
    if (o.status === 'PLACED' || o.status === 'PREPARING') {
      const mins = Math.max(1, o.eta_minutes - Math.floor((Date.now() - o.placed_at) / 60000));
      sub += ` About ${mins} min more.`;
    }
    els.statusSub.textContent = sub;

    const idx = STEP_ORDER.indexOf(o.status);
    [...els.steps.children].forEach((li, i) => {
      li.classList.toggle('done', idx >= 0 && i <= idx);
      li.classList.toggle('current', i === idx);
    });

    els.statusItems.innerHTML = o.items.map((i) => `<div class="rline">
      <span><span class="rline-qty">${i.quantity} ×</span> ${esc(i.name)}
        ${i.special_notes ? `<br><span class="line-note">“${esc(i.special_notes)}”</span>` : ''}</span>
      <span class="rline-amt">${rupees(i.line_total)}</span>
    </div>`).join('');
    // With GST on, the diner pays more than the menu adds up to. Showing the
    // split here means the counter is never the first place they learn that.
    const tax = o.tax_preview;
    els.taxRows.innerHTML = tax ? `
      <div class="taxrow sub"><span>${esc(t('subtotal'))}</span><span>${rupees(tax.taxable_value)}</span></div>
      <div class="taxrow"><span>CGST ${tax.cgst_rate}%</span><span>${rupees(tax.cgst_amount)}</span></div>
      <div class="taxrow"><span>SGST ${tax.sgst_rate}%</span><span>${rupees(tax.sgst_amount)}</span></div>
      ${tax.round_off ? `<div class="taxrow"><span>${esc(t('roundOff'))}</span><span>${tax.round_off > 0 ? '+' : ''}${rupees(tax.round_off)}</span></div>` : ''}` : '';
    els.statusTotal.textContent = rupees(tax ? tax.payable : o.total);
    els.totalLabel.textContent = tax ? t('payable') : t('total');
    renderBillExtras(o);
  }

  async function resumeOrder(id) {
    try {
      const res = await fetch(`/api/orders/${id}?slug=${encodeURIComponent(slug)}`);
      if (!res.ok) { rememberOrder(null); return; }
      const { order } = await res.json();
      // Don't strand someone on last night's receipt.
      if (Date.now() - order.placed_at > 6 * 60 * 60 * 1000) { rememberOrder(null); return; }
      showOrder(order);
      joinOrderRoom(order.id);
    } catch { /* offline — the menu still works */ }
  }

  function joinOrderRoom(id) {
    if (state.socket && state.socket.connected) {
      state.socket.emit(EVENTS.JOIN_ORDER, { order_id: id, qr_slug: slug }, (res) => {
        if (res && res.order) { state.order = res.order; renderStatus(); }
      });
    }
  }

  /* ------------------------------------------------------------ socket */

  function connect() {
    const socket = io({ transports: ['websocket', 'polling'] });
    state.socket = socket;

    socket.on('connect', () => {
      els.conn.hidden = true;
      if (state.order) joinOrderRoom(state.order.id);
    });
    socket.on('disconnect', () => { els.conn.hidden = false; });

    socket.on(EVENTS.ORDER_STATUS_CHANGED, ({ order }) => {
      if (state.order && order.id === state.order.id) {
        state.order = order;
        renderStatus();
        if (navigator.vibrate) navigator.vibrate(60);
      }
    });

    socket.on(EVENTS.MENU_CHANGED, () => {
      fetch('/api/menu').then((r) => r.json()).then(({ categories }) => {
        state.categories = categories;
        pruneCart(); renderMenu(); renderCart();
      }).catch(() => {});
    });
  }

  /* ------------------------------------------------------------ events */

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const id = Number(btn.dataset.id);
    const current = state.cart[id] ? state.cart[id].qty : 0;

    if (btn.dataset.act === 'add' || btn.dataset.act === 'inc') setQty(id, current + 1);
    else if (btn.dataset.act === 'dec') setQty(id, current - 1);
    else if (btn.dataset.act === 'note') {
      const item = findItem(id);
      const existing = (state.cart[id] || {}).notes || '';
      const notes = window.prompt(`Anything special for ${item.name}?\n(e.g. less spicy, no onion)`, existing);
      if (notes === null) return;
      if (!state.cart[id]) state.cart[id] = { qty: 1, notes: '' };
      state.cart[id].notes = notes.trim().slice(0, 200);
      saveCart(); renderMenu(); renderCart();
    }
  });

  document.querySelectorAll('.chip[data-diet]').forEach((chip) => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.chip[data-diet]').forEach((c) => c.classList.remove('is-on'));
      chip.classList.add('is-on');
      state.diet = chip.dataset.diet;
      renderMenu();
    });
  });

  document.querySelectorAll('.lang').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.lang = btn.dataset.lang;
      try { localStorage.setItem(LANG_KEY, state.lang); } catch {}
      document.querySelectorAll('.lang').forEach((b) => b.classList.toggle('is-on', b === btn));
      applyUiLanguage();
      renderAskChrome();
      renderMenu();
      renderCart();
      if (state.order) renderStatus();
    });
  });

  els.quickToggle.addEventListener('click', () => {
    state.quickOnly = !state.quickOnly;
    els.quickToggle.setAttribute('aria-pressed', String(state.quickOnly));
    renderMenu();
  });

  els.askOpen.addEventListener('click', () => {
    els.askPanel.hidden = false;
    els.askOpen.hidden = true;
    els.askInput.focus();
  });
  els.askForm.addEventListener('submit', (e) => {
    e.preventDefault();
    askAssistant(els.askInput.value);
  });
  els.askChips.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-ask]');
    if (!chip) return;
    els.askInput.value = chip.dataset.ask;
    askAssistant(chip.dataset.ask);
  });

  els.cartbar.addEventListener('click', openSheet);
  els.scrim.addEventListener('click', closeSheet);
  document.getElementById('closeSheet').addEventListener('click', closeSheet);
  els.placeOrder.addEventListener('click', placeOrder);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });

  els.newOrder.addEventListener('click', () => {
    rememberOrder(null);
    state.order = null;
    els.viewStatus.hidden = true;
    els.viewMenu.hidden = false;
    renderCart();
    window.scrollTo(0, 0);
  });

  // Keeps the "about N min more" line honest while the tab sits open.
  setInterval(() => {
    if (state.order && ['PLACED', 'PREPARING'].includes(state.order.status)) renderStatus();
  }, 30000);

  boot();
})();
