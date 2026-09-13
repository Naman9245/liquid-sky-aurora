'use strict';

const { GoogleGenAI } = require('@google/genai');
const menuService = require('./menuService');

/**
 * The menu assistant. A diner asks "kuch spicy veg suggest karo" or "what's
 * quick, I have a flight" and gets dishes off this restaurant's actual menu.
 *
 * Grounding is the whole point. The menu is 280 dishes — small enough to put in
 * the prompt whole, so there is no vector store and no retrieval step to get
 * wrong. The model is told, in the strongest terms available, to recommend only
 * from that list, and every dish it names is checked against the menu before
 * anything reaches the diner.
 */

const API_KEY = (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim();
const MODEL = (process.env.GEMINI_MODEL || 'gemini-flash-latest').trim();

/**
 * Gemini returns a 503 "experiencing high demand" often enough that a diner
 * would notice. It is intermittent rather than a real outage, so the primary
 * model is retried first; if it is genuinely busy, the next model in this chain
 * answers instead. A slightly different model beats "ask a member of staff".
 */
const FALLBACK_MODELS = (process.env.GEMINI_FALLBACK_MODELS
  || 'gemini-3.5-flash,gemini-flash-lite-latest')
  .split(',').map((m) => m.trim()).filter(Boolean);

const MODEL_CHAIN = [MODEL, ...FALLBACK_MODELS.filter((m) => m !== MODEL)];
const enabled = API_KEY.length > 0;

const ai = enabled ? new GoogleGenAI({ apiKey: API_KEY }) : null;

/* ------------------------------------------------------------ the menu */

let cached = { text: null, ids: null, builtAt: 0 };

/** A compact line per dish. Ids are how the answer points back at real rows. */
function menuContext() {
  if (cached.text && Date.now() - cached.builtAt < 60000) return cached;

  const categories = menuService.getMenu({ onlyAvailable: true });
  const ids = new Map();
  const lines = [];

  for (const c of categories) {
    lines.push(`\n## ${c.name}`);
    for (const i of c.items) {
      ids.set(i.id, i);
      const bits = [
        `${i.id}|${i.name}`,
        `₹${i.price}`,
        i.diet_type.toLowerCase().replace('_', '-'),
        `${i.prep_minutes}min`,
      ];
      if (i.spice_level >= 3) bits.push('very spicy');
      else if (i.spice_level === 2) bits.push('spicy');
      else if (i.spice_level === 1) bits.push('mild');
      if (i.is_signature) bits.push('signature');
      if (i.description) bits.push(i.description);
      lines.push(bits.join(' · '));
    }
  }

  cached = { text: lines.join('\n'), ids, builtAt: Date.now() };
  return cached;
}

/** Called when the menu changes, so a sold-out dish stops being suggested. */
function invalidate() { cached = { text: null, ids: null, builtAt: 0 }; }

/* ------------------------------------------------------- the instruction */

const LANG_NAME = { en: 'English', hi: 'Hindi', kn: 'Kannada' };

function systemInstruction(lang) {
  return `You help diners at Liquid Sky, a 24-hour multi-cuisine restaurant on the
airport highway in Chikkajala, Bengaluru. You suggest dishes from its menu.

THE MENU IS THE ONLY THING YOU KNOW ABOUT FOOD HERE.
- Recommend only dishes that appear in the menu below. Never invent a dish, a
  price, or a variation that is not listed.
- Refer to a dish by the exact name given, and put its id in dish_ids.
- If nothing on the menu fits what they asked for, say so plainly and suggest
  the nearest thing that IS on the menu.

ALLERGIES AND INGREDIENTS — THIS MATTERS MORE THAN BEING HELPFUL.
- You do not have ingredient lists. You cannot know what any dish contains
  beyond its name and short description.
- Never say a dish is free of anything: not nuts, dairy, gluten, onion, garlic,
  shellfish, or anything else. Never say a dish is "safe".
- If they mention an allergy, an intolerance, or ask what is in a dish, tell
  them to speak to a member of staff, who will check with the kitchen. You may
  still suggest dishes, but say clearly that staff must confirm.
- Veg, egg and non-veg marks in the menu are reliable — you may use those.

HOW TO ANSWER
- Reply in ${LANG_NAME[lang] || 'English'}.
- Two or three sentences. A diner is holding a phone, often in a hurry.
- Suggest at most four dishes.
- Many customers here are catching a flight. If they mention time, prefer
  dishes with a low prep time and say how long they take.
- Prices are in rupees. Do not invent offers, discounts or combos.
- You are not taking the order. The diner adds dishes themselves.`;
}

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string', description: 'The answer to show the diner, 2-3 sentences.' },
    dish_ids: {
      type: 'array',
      description: 'Menu ids of the dishes named in the reply, at most 4.',
      items: { type: 'integer' },
    },
    needs_staff: {
      type: 'boolean',
      description: 'True when the question is about allergies or ingredients and a member of staff must confirm.',
    },
  },
  required: ['reply', 'dish_ids', 'needs_staff'],
};

/* ------------------------------------------------------- rate limiting */

// A public endpoint spending money on every call. One table, a few questions.
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 12;
const hits = new Map();

function rateLimit(key) {
  const now = Date.now();
  const rec = hits.get(key);
  if (!rec || now > rec.resetAt) {
    hits.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true, left: MAX_PER_WINDOW - 1 };
  }
  if (rec.count >= MAX_PER_WINDOW) {
    return { allowed: false, left: 0, retryInMs: rec.resetAt - now };
  }
  rec.count += 1;
  return { allowed: true, left: MAX_PER_WINDOW - rec.count };
}

/* --------------------------------------------------------------- ask */

const ALLERGY_WORDS = /\b(allerg|allergy|allergic|intoleran|gluten|coeliac|celiac|lactose|peanut|nut|shellfish|ingredient|contains?)\b/i;

/**
 * "This model is currently experiencing high demand" is a 503 that clears in a
 * second or two, and a diner should never see it. Overload and rate-limit
 * replies are retried with backoff; a bad key or a bad request is not, because
 * retrying those just wastes time.
 */
const TRANSIENT = new Set([429, 500, 502, 503, 504]);

function statusOf(err) {
  if (err && typeof err.status === 'number') return err.status;
  const m = String((err && err.message) || '').match(/"code"\s*:\s*(\d+)/);
  return m ? Number(m[1]) : 0;
}

async function withRetry(call, attempts = 3) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try { return await call(); }
    catch (err) {
      last = err;
      if (!TRANSIENT.has(statusOf(err)) || i === attempts - 1) throw err;
      const wait = 500 * Math.pow(2, i) + Math.floor(Math.random() * 300);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw last;
}

/** Retry each model, then move down the chain. Returns the first answer. */
async function callWithFallback(buildRequest) {
  let last;
  for (const model of MODEL_CHAIN) {
    try {
      const res = await withRetry(() => ai.models.generateContent(buildRequest(model)));
      if (model !== MODEL) console.warn(`[assistant] ${MODEL} was busy; answered with ${model}`);
      return res;
    } catch (err) {
      last = err;
      if (!TRANSIENT.has(statusOf(err))) throw err;   // a real error, not overload
      console.warn(`[assistant] ${model} unavailable (${statusOf(err)}), trying the next model`);
    }
  }
  throw last;
}

class AssistantError extends Error {
  constructor(message, status = 400) { super(message); this.name = 'AssistantError'; this.status = status; }
}

async function ask({ question, lang = 'en', rateKey = 'anon' }) {
  if (!enabled) throw new AssistantError('The menu assistant is not switched on.', 503);

  const q = String(question || '').trim();
  if (!q) throw new AssistantError('Please type a question.');
  if (q.length > 400) throw new AssistantError('That is a bit long — could you shorten it?');

  const limit = rateLimit(rateKey);
  if (!limit.allowed) {
    throw new AssistantError(
      'You have asked a few questions already. Please give it a few minutes, or ask a member of staff.', 429);
  }

  const { text, ids } = menuContext();

  let raw;
  try {
    raw = await callWithFallback((model) => ({
      model,
      contents: q,
      config: {
        systemInstruction: `${systemInstruction(lang)}\n\nMENU (id|name · price · diet · prep time · notes):\n${text}`,
        responseMimeType: 'application/json',
        responseJsonSchema: RESPONSE_SCHEMA,
        temperature: 0.4,
        // Thinking tokens come out of this budget too — a reply needs ~150, but
        // the model can spend 500+ thinking first. Too low truncates the JSON.
        maxOutputTokens: 4000,
        abortSignal: AbortSignal.timeout(20000),
      },
    })).then((res) => res.text);
  } catch (err) {
    console.error('[assistant]', err && err.message ? err.message : err);
    throw new AssistantError(
      'The assistant is not answering right now. Please ask a member of staff — they know the menu best.', 502);
  }

  let parsed;
  try { parsed = JSON.parse(raw); }
  catch {
    console.error('[assistant] unparseable reply, first 200 chars:', String(raw).slice(0, 200));
    throw new AssistantError('The assistant gave an answer we could not read. Please ask a member of staff.', 502);
  }

  // Every dish it named is checked against the live menu. A hallucinated id is
  // simply dropped rather than shown to a diner as something they can order.
  const suggestions = (Array.isArray(parsed.dish_ids) ? parsed.dish_ids : [])
    .map((id) => ids.get(Number(id)))
    .filter(Boolean)
    .slice(0, 4)
    .map((i) => ({
      id: i.id, name: i.name, name_hi: i.name_hi, name_kn: i.name_kn,
      price: i.price, diet_type: i.diet_type, prep_minutes: i.prep_minutes,
      spice_level: i.spice_level,
    }));

  const askedAboutIngredients = ALLERGY_WORDS.test(q);

  return {
    reply: String(parsed.reply || '').slice(0, 700),
    suggestions,
    // Belt and braces: the model is told to flag these, and we flag them too
    // from the question itself, so the warning cannot be reasoned away.
    needs_staff: !!parsed.needs_staff || askedAboutIngredients,
    asks_left: limit.left,
  };
}

module.exports = {
  ask, enabled, invalidate, MODEL, MODEL_CHAIN, AssistantError,
  menuContext, withRetry, statusOf,
};
