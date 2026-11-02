// The inbox: every customer message becomes a draft that waits for the owner.
// Nothing is sent to a customer until the owner approves it. Blocked drafts can never be approved.
import { processCustomerMessage } from './pipeline.js';

export function createInbox({ brain, client, sendText, draftFn, maxHistory = 6 }) {
  const items = new Map();
  const seen = new Set();
  const histories = new Map(); // customer number -> recent turns
  let counter = 0;

  const remember = (from, who, text) => {
    const h = histories.get(from) ?? [];
    h.push({ from: who, text });
    histories.set(from, h.slice(-maxHistory));
  };

  async function ingestOne(m) {
    if (!m.id || seen.has(m.id)) return null;
    seen.add(m.id);
    const base = {
      id: String(++counter),
      messageId: m.id,
      from: m.from,
      name: m.name,
      customerText: m.text,
      createdAt: new Date().toISOString(),
      reply: '',
      offer: null,
      violations: [],
      reason: '',
    };
    if (m.type !== 'text') {
      const item = { ...base, status: 'unsupported', reason: `A ${m.type} message arrived. Open WhatsApp to see it.` };
      items.set(item.id, item);
      return item;
    }
    let item;
    try {
      const history = histories.get(m.from) ?? [];
      const r = await processCustomerMessage({ message: m.text, history, brain, client, draftFn });
      item = {
        ...base,
        status: r.status,
        reply: r.draft?.reply ?? '',
        offer: r.draft?.offer ?? null,
        violations: r.violations ?? [],
        reason: r.reason ?? '',
      };
    } catch (err) {
      item = { ...base, status: 'error', reason: String(err?.message ?? err).slice(0, 300) };
    }
    remember(m.from, 'customer', m.text);
    items.set(item.id, item);
    return item;
  }

  return {
    /** messages: the array from parseMessages(). Returns the items created. */
    async ingest(messages) {
      const created = [];
      for (const m of messages) {
        const item = await ingestOne(m);
        if (item) created.push(item);
      }
      return created;
    },

    list() {
      return [...items.values()].reverse();
    },

    get(id) {
      return items.get(String(id));
    },

    /** Send the checked draft exactly as it is. Only a needs_approval item can be approved. */
    async approve(id) {
      const item = items.get(String(id));
      if (!item) return { ok: false, error: 'not_found' };
      if (item.status !== 'needs_approval') return { ok: false, error: `cannot_approve_${item.status}` };
      try {
        await sendText(item.from, item.reply);
      } catch (err) {
        item.status = 'send_failed';
        item.reason = String(err?.message ?? err).slice(0, 300);
        return { ok: false, error: 'send_failed' };
      }
      item.status = 'sent';
      remember(item.from, 'owner', item.reply);
      return { ok: true };
    },

    reject(id) {
      const item = items.get(String(id));
      if (!item) return { ok: false, error: 'not_found' };
      if (item.status !== 'needs_approval') return { ok: false, error: `cannot_reject_${item.status}` };
      item.status = 'rejected';
      return { ok: true };
    },
  };
}
