// The owner's approval page: plain HTML, works on a phone. Customer text is untrusted, so it is always escaped.

export function escapeHtml(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const LABELS = {
  needs_approval: 'Waiting for you',
  blocked: 'Blocked by your rules',
  error: 'Could not draft',
  sent: 'Sent',
  rejected: 'Rejected',
  send_failed: 'Send failed',
  unsupported: 'Open WhatsApp',
};

function card(item, key) {
  const who = item.name ? `${escapeHtml(item.name)} (${escapeHtml(item.from)})` : escapeHtml(item.from);
  const violations = item.violations
    .map((v) => `<li>${v.blocking ? 'Blocked' : 'Note'}: ${escapeHtml(v.message)}</li>`)
    .join('');
  const buttons =
    item.status === 'needs_approval'
      ? `<form method="post" action="/decide">
           <input type="hidden" name="key" value="${escapeHtml(key)}">
           <input type="hidden" name="id" value="${escapeHtml(item.id)}">
           <button name="action" value="approve" class="ok">Approve and send</button>
           <button name="action" value="reject" class="no">Reject</button>
         </form>`
      : '';
  return `<section class="card ${escapeHtml(item.status)}">
    <div class="meta"><b>${who}</b> <span class="tag">${escapeHtml(LABELS[item.status] ?? item.status)}</span></div>
    <p class="cust">Customer: ${escapeHtml(item.customerText)}</p>
    ${item.reply ? `<p class="draft">Draft reply: ${escapeHtml(item.reply)}</p>` : ''}
    ${item.reason ? `<p class="reason">${escapeHtml(item.reason)}</p>` : ''}
    ${violations ? `<ul>${violations}</ul>` : ''}
    ${buttons}
  </section>`;
}

export function renderApprovals(items, key) {
  const body = items.length
    ? items.map((i) => card(i, key)).join('\n')
    : '<p class="empty">No messages yet. When a customer writes, the draft appears here.</p>';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="10">
<title>AONE BP approvals</title>
<style>
  body{font-family:system-ui,sans-serif;margin:0;padding:16px;background:#f6f6f4;color:#1b1b1b;max-width:640px;margin-inline:auto}
  h1{font-size:1.2rem}
  .card{background:#fff;border-radius:10px;padding:12px 14px;margin:12px 0;border-left:5px solid #999}
  .needs_approval{border-color:#e0a100}.blocked{border-color:#c0392b}.sent{border-color:#2e8b57}
  .tag{font-size:.75rem;background:#eee;border-radius:99px;padding:2px 8px;margin-left:6px}
  .cust{color:#555}.draft{font-weight:600}.reason{color:#c0392b}
  button{font-size:1rem;padding:10px 14px;border:0;border-radius:8px;margin-right:8px;color:#fff}
  .ok{background:#2e8b57}.no{background:#777}
  .empty{color:#666}
</style></head><body>
<h1>AONE BP: approvals</h1>
<p>Nothing is sent to a customer until you press Approve.</p>
${body}
</body></html>`;
}
