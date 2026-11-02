import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { createInbox } from '../src/inbox.js';
import { createWhatsAppSender, parseMessages, verifyChallenge, verifySignature } from '../src/whatsapp.js';
import { escapeHtml, renderApprovals } from '../src/ownerPage.js';

const brain = JSON.parse(readFileSync(new URL('../data/demo-brain.json', import.meta.url), 'utf8'));
const fake = (text) => async () => text;
const good = '{"reply":"Good afternoon dear, knotless braids is ₦25,000.","offer":{"productId":"braids","price":25000}}';
const bad = '{"reply":"Okay dear, ₦10,000.","offer":{"productId":"braids","price":10000}}';
const msg = (id, text, extra = {}) => ({ id, from: '2348012345678', name: 'Ada', type: 'text', text, ...extra });

function makeInbox(draft, sent = []) {
  return {
    sent,
    inbox: createInbox({ brain, draftFn: fake(draft), sendText: async (to, body) => sent.push({ to, body }) }),
  };
}

test('Meta payload: messages are read, status updates are ignored', () => {
  const payload = {
    entry: [
      {
        changes: [
          {
            value: {
              contacts: [{ wa_id: '2348012345678', profile: { name: 'Ada' } }],
              messages: [{ id: 'wamid.1', from: '2348012345678', type: 'text', text: { body: 'Hi' } }],
            },
          },
          { value: { statuses: [{ id: 'x', status: 'delivered' }] } },
        ],
      },
    ],
  };
  assert.deepEqual(parseMessages(payload), [
    { id: 'wamid.1', from: '2348012345678', name: 'Ada', type: 'text', text: 'Hi' },
  ]);
  assert.deepEqual(parseMessages({}), []);
});

test('webhook verification only passes with the right token', () => {
  const q = { 'hub.mode': 'subscribe', 'hub.verify_token': 'abc', 'hub.challenge': '12345' };
  assert.equal(verifyChallenge(q, 'abc'), '12345');
  assert.equal(verifyChallenge(q, 'nope'), null);
  assert.equal(verifyChallenge(q, ''), null);
});

test('signature check accepts a real signature and rejects a fake one', () => {
  const body = Buffer.from('{"a":1}');
  const sig = 'sha256=' + createHmac('sha256', 'secret').update(body).digest('hex');
  assert.equal(verifySignature(body, sig, 'secret'), true);
  assert.equal(verifySignature(body, 'sha256=deadbeef', 'secret'), false);
  assert.equal(verifySignature(body, undefined, 'secret'), false);
});

test('a customer message becomes a draft that waits, and nothing is sent yet', async () => {
  const { inbox, sent } = makeInbox(good);
  const [item] = await inbox.ingest([msg('m1', 'How much is knotless braids?')]);
  assert.equal(item.status, 'needs_approval');
  assert.equal(sent.length, 0);
});

test('approving sends exactly the checked draft, once', async () => {
  const { inbox, sent } = makeInbox(good);
  const [item] = await inbox.ingest([msg('m1', 'price?')]);
  assert.deepEqual(await inbox.approve(item.id), { ok: true });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, '2348012345678');
  assert.match(sent[0].body, /₦25,000/);
  assert.equal((await inbox.approve(item.id)).ok, false); // no second send
  assert.equal(sent.length, 1);
});

test('a blocked draft can never be approved or sent', async () => {
  const { inbox, sent } = makeInbox(bad);
  const [item] = await inbox.ingest([msg('m1', 'I will pay 10k')]);
  assert.equal(item.status, 'blocked');
  assert.equal((await inbox.approve(item.id)).ok, false);
  assert.equal(sent.length, 0);
});

test('a rejected draft is not sent', async () => {
  const { inbox, sent } = makeInbox(good);
  const [item] = await inbox.ingest([msg('m1', 'price?')]);
  assert.deepEqual(inbox.reject(item.id), { ok: true });
  assert.equal((await inbox.approve(item.id)).ok, false);
  assert.equal(sent.length, 0);
});

test('the same WhatsApp message is not processed twice', async () => {
  const { inbox } = makeInbox(good);
  await inbox.ingest([msg('m1', 'price?')]);
  const again = await inbox.ingest([msg('m1', 'price?')]);
  assert.equal(again.length, 0);
  assert.equal(inbox.list().length, 1);
});

test('voice notes and photos are shown to the owner, not answered', async () => {
  const { inbox, sent } = makeInbox(good);
  const [item] = await inbox.ingest([msg('m2', '', { type: 'audio' })]);
  assert.equal(item.status, 'unsupported');
  assert.equal((await inbox.approve(item.id)).ok, false);
  assert.equal(sent.length, 0);
});

test('if the model call fails, the item is an error and nothing is sent', async () => {
  const sent = [];
  const inbox = createInbox({
    brain,
    draftFn: async () => {
      throw new Error('model down');
    },
    sendText: async (to, body) => sent.push({ to, body }),
  });
  const [item] = await inbox.ingest([msg('m1', 'hi')]);
  assert.equal(item.status, 'error');
  assert.equal(sent.length, 0);
});

test('if WhatsApp refuses the send, the item is marked send_failed', async () => {
  const inbox = createInbox({
    brain,
    draftFn: fake(good),
    sendText: async () => {
      throw new Error('WhatsApp send failed (401)');
    },
  });
  const [item] = await inbox.ingest([msg('m1', 'price?')]);
  assert.deepEqual(await inbox.approve(item.id), { ok: false, error: 'send_failed' });
  assert.equal(inbox.get(item.id).status, 'send_failed');
});

test('the owner page escapes customer text so a customer cannot inject a script', async () => {
  const { inbox } = makeInbox(good);
  await inbox.ingest([msg('m1', '<script>alert(1)</script>', { name: '<b>x</b>' })]);
  const html = renderApprovals(inbox.list(), 'k');
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.equal(escapeHtml(`"'&<>`), '&quot;&#39;&amp;&lt;&gt;');
});

test('the WhatsApp sender needs its keys, uses a header, and never leaks the token', async () => {
  assert.throws(() => createWhatsAppSender({}), /WHATSAPP_TOKEN/);
  assert.throws(() => createWhatsAppSender({ WHATSAPP_TOKEN: 't' }), /WHATSAPP_PHONE_NUMBER_ID/);
  const calls = [];
  const ok = async (url, init) => (calls.push({ url, init }), { ok: true, json: async () => ({}) });
  const s = createWhatsAppSender({ WHATSAPP_TOKEN: 'tok-123', WHATSAPP_PHONE_NUMBER_ID: '999' }, ok);
  await s.sendText('2348012345678', 'Hello');
  assert.match(calls[0].url, /graph\.facebook\.com\/v\d+\.\d+\/999\/messages$/);
  assert.equal(calls[0].init.headers.authorization, 'Bearer tok-123');
  assert.ok(!calls[0].init.body.includes('tok-123'));
  const fail = async () => ({ ok: false, status: 401, text: async () => 'bad token' });
  const s2 = createWhatsAppSender({ WHATSAPP_TOKEN: 'tok-123', WHATSAPP_PHONE_NUMBER_ID: '999' }, fail);
  await assert.rejects(() => s2.sendText('1', 'x'), (e) => /401/.test(e.message) && !e.message.includes('tok-123'));
});
