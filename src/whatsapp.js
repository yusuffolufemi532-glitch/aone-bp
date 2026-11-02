// WhatsApp Cloud API helpers: verify Meta's webhook, read incoming messages, send a text.
// No packages needed. Secrets come from environment variables, never from code.
import { createHmac, timingSafeEqual } from 'node:crypto';

export const GRAPH_VERSION = 'v25.0';

/**
 * Meta checks your webhook address once by sending a GET with a challenge.
 * Return the challenge text if the token matches, otherwise null.
 */
export function verifyChallenge(query, verifyToken) {
  if (!verifyToken) return null;
  if (query['hub.mode'] === 'subscribe' && query['hub.verify_token'] === verifyToken) {
    return query['hub.challenge'] ?? '';
  }
  return null;
}

/**
 * Check Meta's signature on a POST (header x-hub-signature-256).
 * If no app secret is configured, the check is skipped (fine for local testing only).
 */
export function verifySignature(rawBody, header, appSecret) {
  if (!appSecret) return true;
  if (!header || !header.startsWith('sha256=')) return false;
  const expected = createHmac('sha256', appSecret).update(rawBody).digest('hex');
  const given = header.slice('sha256='.length);
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Pull the customer messages out of Meta's webhook payload. Status updates are ignored. */
export function parseMessages(payload) {
  const out = [];
  for (const entry of payload?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      const value = change?.value;
      if (!value?.messages) continue;
      const names = new Map((value.contacts ?? []).map((c) => [c.wa_id, c.profile?.name ?? '']));
      for (const m of value.messages) {
        out.push({
          id: m.id,
          from: m.from,
          name: names.get(m.from) ?? '',
          type: m.type,
          text: m.type === 'text' ? (m.text?.body ?? '') : '',
        });
      }
    }
  }
  return out;
}

/** A tiny sender: sendText(to, body). Errors never include the access token. */
export function createWhatsAppSender(env = process.env, fetchImpl = globalThis.fetch) {
  const token = env.WHATSAPP_TOKEN;
  const phoneNumberId = env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token) throw new Error('WHATSAPP_TOKEN is not set');
  if (!phoneNumberId) throw new Error('WHATSAPP_PHONE_NUMBER_ID is not set');
  const version = env.WHATSAPP_API_VERSION || GRAPH_VERSION;
  return {
    async sendText(to, body) {
      const res = await fetchImpl(`https://graph.facebook.com/${version}/${phoneNumberId}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body } }),
      });
      if (!res.ok) {
        const detail = (await res.text().catch(() => '')).slice(0, 300);
        throw new Error(`WhatsApp send failed (${res.status}): ${detail}`);
      }
      return res.json();
    },
  };
}
