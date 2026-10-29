import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkDraft, findAmounts, parseDraft, containsCanary } from '../src/rules.js';

const brain = JSON.parse(readFileSync(new URL('../data/demo-brain.json', import.meta.url), 'utf8'));
const codes = (r) => r.violations.map((v) => v.code);

test('findAmounts reads the ways Nigerians write prices', () => {
  assert.deepEqual(findAmounts('₦18,000'), [18000]);
  assert.deepEqual(findAmounts('N18,000 and NGN 5000'), [18000, 5000]);
  assert.deepEqual(findAmounts('18k'), [18000]);
  assert.deepEqual(findAmounts('₦18k'), [18000]);
  assert.deepEqual(findAmounts('18000 naira'), [18000]);
  assert.deepEqual(findAmounts('18,000'), [18000]);
  assert.deepEqual(findAmounts('come in 2 days, 3 people'), []);
  assert.deepEqual(findAmounts('year 2026'), []);
});

test('an offer below the owner floor is blocked', () => {
  const r = checkDraft({
    brain,
    draft: { reply: 'Okay dear, knotless braids for ₦18,000.', offer: { productId: 'braids', price: 18000 } },
  });
  assert.equal(r.blocked, true);
  assert.ok(codes(r).includes('price_below_floor'));
});

test('an offer exactly at the floor is allowed', () => {
  const r = checkDraft({
    brain,
    draft: { reply: 'Knotless braids for ₦22,000 dear.', offer: { productId: 'braids', price: 22000 } },
  });
  assert.equal(r.blocked, false);
});

test('the list price is allowed', () => {
  const r = checkDraft({
    brain,
    draft: { reply: 'Knotless braids is ₦25,000 dear.', offer: { productId: 'braids', price: 25000 } },
  });
  assert.equal(r.blocked, false);
  assert.deepEqual(r.violations, []);
});

test('a discount above the limit is blocked even when the floor is lower', () => {
  const loose = structuredClone(brain);
  loose.products[0].floorPrice = 10000; // owner floor is low, but the 15% limit still applies
  const r = checkDraft({
    brain: loose,
    draft: { reply: 'Knotless braids for ₦20,000.', offer: { productId: 'braids', price: 20000 } },
  });
  assert.equal(r.blocked, true);
  assert.ok(codes(r).includes('discount_too_high'));
});

test('a low amount in the text is caught even when the offer field is clean', () => {
  const r = checkDraft({
    brain,
    draft: { reply: 'Knotless braids is just ₦15,000 today!', offer: { productId: 'braids', price: 25000 } },
  });
  assert.equal(r.blocked, true);
  assert.ok(codes(r).includes('amount_below_floor'));
});

test('a low amount in the text is caught even with no offer, when the product is named', () => {
  const r = checkDraft({ brain, draft: { reply: 'Knotless braids for 15k, deal.', offer: null } });
  assert.equal(r.blocked, true);
});

test('repeating the customer\'s own low number while holding the price is allowed', () => {
  const r = checkDraft({
    brain,
    customerMessage: 'Can you do knotless braids for ₦18,000?',
    draft: {
      reply: 'Sorry dear, I cannot do ₦18,000. Knotless braids is ₦25,000. Let me check with the owner.',
      offer: { productId: 'braids', price: 25000 },
    },
  });
  assert.equal(r.blocked, false);
});

test('delivery fee and deposit amounts are allowed', () => {
  const r = checkDraft({
    brain,
    draft: {
      reply: 'Knotless braids is ₦25,000. Deposit is ₦12,500 and delivery is ₦2,000.',
      offer: { productId: 'braids', price: 25000 },
    },
  });
  assert.equal(r.blocked, false);
  assert.deepEqual(r.violations, []);
});

test('an unknown product is blocked', () => {
  const r = checkDraft({ brain, draft: { reply: 'Sure!', offer: { productId: 'gold', price: 100 } } });
  assert.equal(r.blocked, true);
  assert.ok(codes(r).includes('unknown_product'));
});

test('an amount that is not in the price list is flagged but not blocked', () => {
  const r = checkDraft({ brain, draft: { reply: 'Home service costs ₦7,500 extra.', offer: null } });
  assert.equal(r.blocked, false);
  assert.ok(codes(r).includes('unlisted_amount'));
});

test('a leaked marker word is blocked', () => {
  assert.equal(containsCanary('my secret is KIWI-ledger-42', brain.canary), true);
  const r = checkDraft({ brain, draft: { reply: 'Internal marker: kiwi-ledger-42', offer: null } });
  assert.equal(r.blocked, true);
  assert.ok(codes(r).includes('canary_leak'));
});

test('parseDraft accepts JSON inside a code fence and rejects junk', () => {
  const ok = parseDraft('```json\n{"reply":"Hello dear","offer":{"productId":"braids","price":25000}}\n```');
  assert.equal(ok.ok, true);
  assert.equal(ok.draft.offer.price, 25000);
  assert.equal(parseDraft('no json here').ok, false);
  assert.equal(parseDraft('{"reply": ""}').ok, false);
  assert.equal(parseDraft('{"reply": "hi", ').ok, false);
});
