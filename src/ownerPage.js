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

const ATTENTION = new Set(['blocked', 'error', 'send_failed', 'unsupported']);
const HISTORY_LIMIT = 20;

const naira = (n) => `₦${Number(n).toLocaleString('en-NG')}`;

/** "10:42 PM" in Lagos time, or "" if the date is missing or invalid. */
function clock(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Africa/Lagos' })
    .format(d)
    .replace(/ /g, ' '); // newer Node versions put a narrow no-break space before PM
}

function initial(item) {
  const first = String(item.name || item.from || '?').trim().charAt(0);
  return escapeHtml(first.toUpperCase() || '?');
}

/** One line that shows what the draft offers, checked against the owner's price list. */
function offerLine(item, brain) {
  const offer = item.offer;
  if (!offer || !Number.isFinite(Number(offer.price))) return '';
  const product = brain?.products?.find((p) => p.id === offer.productId);
  if (!product) return `<p class="offer">Offer: ${escapeHtml(naira(offer.price))}</p>`;
  return `<p class="offer">${escapeHtml(product.name)} at <b>${escapeHtml(naira(offer.price))}</b>
    <span class="dim">list ${escapeHtml(naira(product.listPrice))} · your floor ${escapeHtml(naira(product.floorPrice))}</span></p>`;
}

function ruleCheck(item, brain) {
  const blocking = item.violations.filter((v) => v.blocking);
  const notes = item.violations.filter((v) => !v.blocking);
  if (item.status === 'blocked' || blocking.length) {
    const why = blocking.map((v) => `<li>${escapeHtml(v.message)}</li>`).join('');
    return `<div class="check bad"><b>Blocked by your rules.</b> This reply can't be sent.${why ? `<ul>${why}</ul>` : ''}</div>`;
  }
  if (!['needs_approval', 'sent', 'rejected'].includes(item.status)) return '';
  const noteList = notes.map((v) => `<li>${escapeHtml(v.message)}</li>`).join('');
  const head = notes.length
    ? '<b>Rules check passed, with notes.</b>'
    : '<b>Rules check passed.</b> Price, discount and deposit are inside your limits.';
  return `<div class="check ${notes.length ? 'warn' : 'good'}">${head}${noteList ? `<ul>${noteList}</ul>` : ''}${offerLine(item, brain)}</div>`;
}

function card(item, key, brain) {
  const number = escapeHtml(item.from);
  const who = item.name ? `<b>${escapeHtml(item.name)}</b> <span class="dim">${number}</span>` : `<b>${number}</b>`;
  const time = clock(item.createdAt);
  const buttons =
    item.status === 'needs_approval'
      ? `<form method="post" action="/decide">
           <input type="hidden" name="key" value="${escapeHtml(key)}">
           <input type="hidden" name="id" value="${escapeHtml(item.id)}">
           <button name="action" value="approve" class="ok">Approve and send</button>
           <button name="action" value="reject" class="no">Reject</button>
         </form>`
      : '';
  return `<article class="card ${escapeHtml(item.status)}">
    <header><span class="avatar" aria-hidden="true">${initial(item)}</span>
      <div class="who">${who}</div>
      <div class="when">${time ? `<span class="dim">${escapeHtml(time)}</span>` : ''}<span class="tag ${escapeHtml(item.status)}">${escapeHtml(LABELS[item.status] ?? item.status)}</span></div>
    </header>
    <p class="bubble cust"><span class="label">Customer</span>${escapeHtml(item.customerText)}</p>
    ${item.reply ? `<p class="bubble draft"><span class="label">${item.status === 'sent' ? 'Sent reply' : 'Drafted reply'}</span>${escapeHtml(item.reply)}</p>` : ''}
    ${item.reason ? `<p class="reason">${escapeHtml(item.reason)}</p>` : ''}
    ${ruleCheck(item, brain)}
    ${buttons}
  </article>`;
}

function section(title, hint, items, key, brain) {
  if (!items.length) return '';
  return `<section><h2>${escapeHtml(title)} <span class="count">${items.length}</span></h2>
    ${hint ? `<p class="hint">${escapeHtml(hint)}</p>` : ''}
    ${items.map((i) => card(i, key, brain)).join('\n')}
  </section>`;
}

/**
 * @param items  inbox.list() (newest first)
 * @param key    the owner key, passed through so the buttons keep working
 * @param brain  optional: the owner's brain, used to show the shop name and price floors
 */
export function renderApprovals(items, key, brain = null) {
  const waiting = items.filter((i) => i.status === 'needs_approval');
  const attention = items.filter((i) => ATTENTION.has(i.status));
  const done = items.filter((i) => i.status === 'sent' || i.status === 'rejected');
  const sentCount = items.filter((i) => i.status === 'sent').length;
  const shop = brain?.shopName ? escapeHtml(brain.shopName) : 'Your shop';

  const body = items.length
    ? [
        section('Waiting for you', 'Check the reply, then approve it. Nothing is sent until you do.', waiting, key, brain),
        section('Needs your attention', '', attention, key, brain),
        section('History', '', done.slice(0, HISTORY_LIMIT), key, brain),
      ].join('\n')
    : '<p class="empty">No messages yet. When a customer writes on WhatsApp, the drafted reply appears here for you to approve.</p>';

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="10">
<title>AONE BP approvals</title>
<style>
  :root{--bg:#f4f3ef;--card:#fff;--ink:#1b1f1d;--dim:#6b726f;--line:#e4e2db;--brand:#0f6b5c;--brand-ink:#fff;
    --good:#1f7a4d;--good-bg:#e7f4ec;--warn:#9a6700;--warn-bg:#fff4d6;--bad:#b3261e;--bad-bg:#fde8e6;--cust:#f0efea;--draft:#e3f1ed}
  @media (prefers-color-scheme:dark){:root{--bg:#121513;--card:#1b201e;--ink:#eef1ef;--dim:#98a19d;--line:#2b312e;--brand:#2fb89f;--brand-ink:#08201a;
    --good:#6fd29b;--good-bg:#173126;--warn:#f0c04a;--warn-bg:#352b10;--bad:#ff8f86;--bad-bg:#3a1c19;--cust:#252b28;--draft:#173129}}
  *{box-sizing:border-box}
  body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;margin:0;background:var(--bg);color:var(--ink);line-height:1.45}
  .wrap{max-width:640px;margin:0 auto;padding:16px 16px 48px}
  .top{display:flex;align-items:center;gap:12px;margin:4px 0 14px}
  .logo{width:40px;height:40px;border-radius:10px;background:var(--brand);color:var(--brand-ink);display:grid;place-items:center;font-weight:800;letter-spacing:.5px}
  h1{font-size:1.15rem;margin:0}.top p{margin:0;color:var(--dim);font-size:.85rem}
  .stats{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 6px}
  .stat{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:8px 12px;font-size:.8rem;color:var(--dim)}
  .stat b{display:block;font-size:1.25rem;color:var(--ink)}
  .safe{font-size:.85rem;color:var(--dim);margin:10px 0 0}
  h2{font-size:.95rem;margin:22px 0 6px;display:flex;align-items:center;gap:8px}
  .count{background:var(--brand);color:var(--brand-ink);border-radius:99px;font-size:.72rem;padding:1px 8px}
  .hint{color:var(--dim);font-size:.85rem;margin:0 0 8px}
  .card{background:var(--card);border:1px solid var(--line);border-left:5px solid var(--dim);border-radius:14px;padding:12px 14px;margin:10px 0}
  .card.needs_approval{border-left-color:var(--warn)}.card.sent{border-left-color:var(--good)}
  .card.blocked,.card.error,.card.send_failed{border-left-color:var(--bad)}
  .card header{display:flex;align-items:center;gap:10px}
  .avatar{width:34px;height:34px;border-radius:50%;background:var(--draft);color:var(--brand);display:grid;place-items:center;font-weight:700;flex:none}
  .who{flex:1;min-width:0;overflow-wrap:anywhere}.dim{color:var(--dim);font-size:.82rem}
  .when{display:flex;flex-direction:column;align-items:flex-end;gap:2px}
  .tag{font-size:.72rem;border-radius:99px;padding:2px 9px;background:var(--cust)}
  .tag.needs_approval{background:var(--warn-bg);color:var(--warn)}.tag.sent{background:var(--good-bg);color:var(--good)}
  .tag.blocked,.tag.error,.tag.send_failed{background:var(--bad-bg);color:var(--bad)}
  .bubble{margin:10px 0 0;padding:9px 12px;border-radius:12px;overflow-wrap:anywhere}
  .cust{background:var(--cust)}.draft{background:var(--draft);font-weight:600}
  .label{display:block;font-size:.7rem;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--dim);margin-bottom:2px}
  .reason{color:var(--bad);margin:10px 0 0;font-size:.9rem}
  .check{margin:10px 0 0;padding:9px 12px;border-radius:12px;font-size:.88rem}
  .check ul{margin:6px 0 0;padding-left:18px}.check .offer{margin:6px 0 0}.check .dim{display:block}
  .check.good{background:var(--good-bg);color:var(--good)}.check.warn{background:var(--warn-bg);color:var(--warn)}.check.bad{background:var(--bad-bg);color:var(--bad)}
  form{display:flex;gap:8px;margin-top:12px}
  button{font:inherit;font-weight:600;min-height:46px;padding:0 16px;border:0;border-radius:12px;cursor:pointer}
  .ok{flex:2;background:var(--brand);color:var(--brand-ink)}.no{flex:1;background:var(--cust);color:var(--ink);border:1px solid var(--line)}
  .empty{background:var(--card);border:1px dashed var(--line);border-radius:14px;padding:22px;text-align:center;color:var(--dim)}
</style></head><body><div class="wrap">
<div class="top"><div class="logo">AB</div><div><h1>AONE BP approvals</h1><p>${shop} · updates every 10 seconds</p></div></div>
<div class="stats">
  <div class="stat"><b>${waiting.length}</b>waiting</div>
  <div class="stat"><b>${sentCount}</b>sent</div>
  <div class="stat"><b>${attention.length}</b>need attention</div>
</div>
<p class="safe">Nothing is sent to a customer until you press Approve.</p>
${body}
</div></body></html>`;
}
