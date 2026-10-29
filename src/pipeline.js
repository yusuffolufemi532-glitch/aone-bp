// One customer message in, one decision out.
// Nothing here ever sends a message. Every draft that passes the rules goes to the
// owner for approval, and a draft that breaks a rule is blocked by code.
import { draftReply } from './model.js';
import { checkDraft, parseDraft } from './rules.js';

/**
 * @returns {Promise<{status: 'needs_approval'|'blocked'|'error', draft?: object, violations: object[], reason?: string}>}
 */
export async function processCustomerMessage({ message, history = [], brain, client, draftFn = draftReply }) {
  const raw = await draftFn({ client, brain, history, message });
  const parsed = parseDraft(raw);
  if (!parsed.ok) return { status: 'error', reason: parsed.error, violations: [] };

  const check = checkDraft({ draft: parsed.draft, brain, customerMessage: message });
  if (check.blocked) return { status: 'blocked', draft: parsed.draft, violations: check.violations };
  return { status: 'needs_approval', draft: parsed.draft, violations: check.violations };
}
