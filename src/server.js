// Run:  node --env-file=.env src/server.js
// Needs in .env: BASETEN_API_KEY, WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, VERIFY_TOKEN, OWNER_KEY
// Optional: WHATSAPP_APP_SECRET (checks Meta's signature), PORT (default 3000)
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { createHash, timingSafeEqual } from 'node:crypto';
import { createBasetenClient } from './model.js';
import { createInbox } from './inbox.js';
import { createWhatsAppSender, parseMessages, verifyChallenge, verifySignature } from './whatsapp.js';
import { renderApprovals } from './ownerPage.js';

const env = process.env;
for (const name of ['VERIFY_TOKEN', 'OWNER_KEY']) {
  if (!env[name]) {
    console.error(`${name} is not set. Add it to your .env file (make up a long random word).`);
    process.exit(1);
  }
}

const brain = JSON.parse(readFileSync(new URL('../data/demo-brain.json', import.meta.url), 'utf8'));
const client = createBasetenClient(env);
const sender = createWhatsAppSender(env);
const inbox = createInbox({ brain, client, sendText: sender.sendText });

const digest = (s) => createHash('sha256').update(String(s)).digest();
const keyOk = (given) => timingSafeEqual(digest(given), digest(env.OWNER_KEY));

function readBody(req, limit = 1_000_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('body too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const send = (res, status, body, type = 'text/plain; charset=utf-8', extra = {}) => {
  res.writeHead(status, { 'content-type': type, ...extra });
  res.end(body);
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');

    // 1. Meta checks the webhook address
    if (req.method === 'GET' && url.pathname === '/webhook') {
      const challenge = verifyChallenge(Object.fromEntries(url.searchParams), env.VERIFY_TOKEN);
      return challenge === null ? send(res, 403, 'forbidden') : send(res, 200, challenge);
    }

    // 2. A customer message arrives
    if (req.method === 'POST' && url.pathname === '/webhook') {
      const raw = await readBody(req);
      if (!verifySignature(raw, req.headers['x-hub-signature-256'], env.WHATSAPP_APP_SECRET)) {
        return send(res, 403, 'bad signature');
      }
      send(res, 200, 'ok'); // answer Meta fast, then do the slow work
      let payload;
      try {
        payload = JSON.parse(raw.toString('utf8'));
      } catch {
        return;
      }
      const created = await inbox.ingest(parseMessages(payload));
      for (const i of created) console.log(`[${i.id}] ${i.from}: ${i.status}`);
      return;
    }

    // 3. The owner's approval page
    if (req.method === 'GET' && url.pathname === '/approvals') {
      const key = url.searchParams.get('key') ?? '';
      if (!keyOk(key)) return send(res, 401, 'wrong key');
      return send(res, 200, renderApprovals(inbox.list(), key, brain), 'text/html; charset=utf-8');
    }

    // 4. The owner presses Approve or Reject
    if (req.method === 'POST' && url.pathname === '/decide') {
      const form = new URLSearchParams((await readBody(req)).toString('utf8'));
      const key = form.get('key') ?? '';
      if (!keyOk(key)) return send(res, 401, 'wrong key');
      const id = form.get('id');
      const result = form.get('action') === 'approve' ? await inbox.approve(id) : inbox.reject(id);
      if (!result.ok) console.log(`decide ${id}: ${result.error}`);
      return send(res, 303, '', 'text/plain', { location: `/approvals?key=${encodeURIComponent(key)}` });
    }

    send(res, 404, 'not found');
  } catch (err) {
    console.error('request failed:', err.message);
    if (!res.headersSent) send(res, 500, 'error');
  }
});

const port = Number(env.PORT) || 3000;
server.listen(port, () => {
  console.log(`AONE BP is running on http://localhost:${port}`);
  console.log(`Owner page: http://localhost:${port}/approvals?key=YOUR_OWNER_KEY`);
});
