// Owner rules, enforced in plain code. The model never decides these.
//
// A draft from the model looks like:
//   { reply: "text for the customer", offer: { productId: "braids", price: 25000 } | null }
// checkDraft() returns violations. A "blocking" violation means the draft must
// never be sent, and the owner has to change the rule first if they want an exception.

// Matches: ₦18,000  N18,000  NGN 18000  ₦18k  18k  18,000 naira  18,000
const AMOUNT =
  /(?:₦|NGN\s?|\bN(?=\d))\s?(\d[\d,]*(?:\.\d+)?)(\s?k\b)?|(\d[\d,]*(?:\.\d+)?)\s?(k\b|naira\b)|\b(\d{1,3}(?:,\d{3})+)\b/gi;

/** Every naira amount mentioned in a piece of text, as numbers. */
export function findAmounts(text) {
  const found = [];
  for (const m of String(text ?? '').matchAll(AMOUNT)) {
    let raw;
    let thousands = false;
    if (m[1] !== undefined) {
      raw = m[1];
      thousands = Boolean(m[2]);
    } else if (m[3] !== undefined) {
      raw = m[3];
      thousands = /^k$/i.test(m[4]);
    } else {
      raw = m[5];
    }
    const n = Number(raw.replace(/,/g, ''));
    if (Number.isFinite(n)) found.push(thousands ? n * 1000 : n);
  }
  return found;
}

/** True if the hidden marker word appears in text (a sign the prompt leaked). */
export function containsCanary(text, canary) {
  if (!canary) return false;
  return String(text ?? '').toLowerCase().includes(String(canary).toLowerCase());
}

function depositAmounts(brain, extraPrices) {
  const pct = brain.rules?.depositPercent;
  if (!pct) return [];
  const prices = [...brain.products.map((p) => p.listPrice), ...extraPrices];
  return prices.map((p) => Math.round((p * pct) / 100));
}

/**
 * Check one model draft against the owner's rules.
 * @returns {{ blocked: boolean, violations: Array<{code:string, blocking:boolean, message:string}> }}
 */
export function checkDraft({ draft, brain, customerMessage = '' }) {
  const violations = [];
  const add = (code, blocking, message) => violations.push({ code, blocking, message });
  const rules = brain.rules ?? {};
  const reply = draft.reply ?? '';
  const offer = draft.offer ?? null;

  // Products this reply is about: the declared offer plus any product named in the text.
  const referenced = new Map();
  if (offer) {
    const p = brain.products.find((x) => x.id === offer.productId);
    if (!p) add('unknown_product', true, `The draft offers a product that is not in the price list (${offer.productId}).`);
    else referenced.set(p.id, p);
    if (typeof offer.price !== 'number' || !Number.isFinite(offer.price) || offer.price <= 0) {
      add('bad_offer', true, 'The draft has an offer without a valid price.');
    }
  }
  const lowerReply = reply.toLowerCase();
  for (const p of brain.products) {
    if (lowerReply.includes(p.name.toLowerCase())) referenced.set(p.id, p);
  }

  // Amounts that are fine to appear even when they are below a price floor.
  const customerAmounts = findAmounts(customerMessage);
  const allowedLow = new Set([
    ...(rules.otherAmounts ?? []),
    ...customerAmounts,
    ...depositAmounts(brain, offer && typeof offer.price === 'number' ? [offer.price] : []),
  ]);

  // 1. The offered price and discount.
  if (offer && typeof offer.price === 'number') {
    const p = referenced.get(offer.productId);
    if (p) {
      if (offer.price < p.floorPrice) {
        add('price_below_floor', true, `${p.name} was offered at ₦${offer.price.toLocaleString('en-NG')}, below the owner's lowest price.`);
      }
      const discount = ((p.listPrice - offer.price) / p.listPrice) * 100;
      if (rules.maxDiscountPercent !== undefined && discount > rules.maxDiscountPercent + 1e-9) {
        add('discount_too_high', true, `The discount is ${discount.toFixed(1)}%, above the owner's limit of ${rules.maxDiscountPercent}%.`);
      }
    }
  }

  // 2. Any amount in the text that is below the floor of a product the reply talks about.
  for (const amt of findAmounts(reply)) {
    for (const p of referenced.values()) {
      if (amt < p.floorPrice && !allowedLow.has(amt)) {
        add('amount_below_floor', true, `The reply mentions ₦${amt.toLocaleString('en-NG')} next to ${p.name}, below the owner's lowest price.`);
        break;
      }
    }
  }

  // 3. A leaked hidden marker word means the prompt may have leaked.
  if (containsCanary(reply, brain.canary)) {
    add('canary_leak', true, 'The reply contains the hidden marker word, so the instructions may have leaked.');
  }

  // 4. Amounts nobody listed: not blocking, but the owner should look.
  const known = new Set([
    ...brain.products.map((p) => p.listPrice),
    ...allowedLow,
    ...(offer && typeof offer.price === 'number' ? [offer.price] : []),
  ]);
  for (const amt of findAmounts(reply)) {
    if (!known.has(amt) && !violations.some((v) => v.code === 'amount_below_floor')) {
      add('unlisted_amount', false, `The reply mentions ₦${amt.toLocaleString('en-NG')}, which is not in the price list.`);
    }
  }

  // Remove duplicate messages (same code and message).
  const seen = new Set();
  const unique = violations.filter((v) => {
    const key = `${v.code}|${v.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { blocked: unique.some((v) => v.blocking), violations: unique };
}

/**
 * Turn the model's raw text into a draft. Accepts plain JSON or JSON inside a code fence.
 * @returns {{ ok: true, draft: {reply:string, offer:object|null} } | { ok: false, error: string }}
 */
export function parseDraft(raw) {
  const text = String(raw ?? '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return { ok: false, error: 'No JSON object in the model output.' };
  let obj;
  try {
    obj = JSON.parse(text.slice(start, end + 1));
  } catch {
    return { ok: false, error: 'The model output was not valid JSON.' };
  }
  if (typeof obj.reply !== 'string' || obj.reply.trim() === '') {
    return { ok: false, error: 'The draft has no reply text.' };
  }
  let offer = null;
  if (obj.offer && typeof obj.offer === 'object') {
    offer = { productId: String(obj.offer.productId ?? ''), price: Number(obj.offer.price) };
  }
  return { ok: true, draft: { reply: obj.reply.trim(), offer } };
}
