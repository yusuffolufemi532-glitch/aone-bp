import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderApprovals } from '../src/ownerPage.js';

const brain = JSON.parse(readFileSync(new URL('../data/demo-brain.json', import.meta.url), 'utf8'));

const item = (id, status, extra = {}) => ({
  id: String(id),
  from: '2348012345678',
  name: 'Ada',
  customerText: 'How much is knotless braids?',
  createdAt: '2026-11-02T21:42:00.000Z',
  reply: 'Hello dear, knotless braids is ₦25,000.',
  offer: { productId: 'braids', price: 25000 },
  violations: [],
  reason: '',
  status,
  ...extra,
});

test('waiting drafts show a clean rules check, the price floor and the Approve button', () => {
  const html = renderApprovals([item(1, 'needs_approval')], 'k', brain);
  assert.match(html, /Waiting for you/);
  assert.match(html, /Rules check passed/);
  assert.match(html, /your floor ₦22,000/);
  assert.match(html, /Approve and send/);
  assert.match(html, /10:42 PM/); // 21:42 UTC is 10:42 PM in Lagos
});

test('blocked drafts show the reason and can never be approved from the page', () => {
  const blocked = item(2, 'blocked', {
    offer: { productId: 'braids', price: 10000 },
    violations: [{ code: 'amount_below_floor', blocking: true, message: '₦10,000 is below your floor of ₦22,000.' }],
  });
  const html = renderApprovals([blocked], 'k', brain);
  assert.match(html, /Needs your attention/);
  assert.match(html, /Blocked by your rules/);
  assert.match(html, /below your floor/);
  assert.ok(!html.includes('Approve and send'));
});

test('sent and rejected messages go to the history list, with no buttons', () => {
  const html = renderApprovals([item(3, 'sent'), item(4, 'rejected')], 'k', brain);
  assert.match(html, /History/);
  assert.match(html, /Sent reply/);
  assert.ok(!html.includes('Approve and send'));
});

test('the page still works without a brain and with an empty inbox', () => {
  assert.match(renderApprovals([item(5, 'needs_approval')], 'k'), /Rules check passed/);
  assert.match(renderApprovals([], 'k', brain), /No messages yet/);
});

test('customer text, names and the key are escaped, and a bad date does not crash', () => {
  const evil = item(6, 'needs_approval', {
    name: '<img src=x onerror=alert(1)>',
    customerText: '<script>alert(1)</script>',
    createdAt: 'not a date',
  });
  const html = renderApprovals([evil], '"><script>x</script>', brain);
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(!html.includes('<img src=x'));
  assert.ok(!html.includes('"><script>x</script>'));
});
