# AONE BP

A WhatsApp business partner for Nigerian salons and small vendors. It reads a customer's message, drafts a reply in the owner's own tone, checks the draft against the owner's price rules, and sends nothing until the owner approves it.

Built solo for the Meta Global AI Developer Hackathon (Indie track).

## What it does

1. A customer sends a WhatsApp message to the business number.
2. The message reaches our webhook (WhatsApp Cloud API).
3. A Meta model (`muse-spark-open`, served through Baseten) drafts a reply in the owner's tone.
4. A rules engine checks the draft in code: price floors, maximum discount (15%), deposit (50%), and a canary word that catches leaks.
5. The draft appears on the owner's approval page. The owner presses **Approve and send** or **Reject**.
6. Only an approved draft is sent back to the customer on WhatsApp.

Nothing is ever sent automatically. Drafts that break a rule are shown as blocked and cannot be approved.

## Why the rules are in code

Prices and discounts are business decisions, so they are not left to the model. The model writes the words. Our code decides whether the draft is allowed. Customer text is wrapped in `<customer_message>` tags so it is treated as data, not as instructions.

## Existing before the hackathon

An earlier design prototype with sample data, with no AI and no backend. None of its code or history is in this repository.

## Built during the hackathon

Everything in this repository was built during the event:

- Rules engine and model client (`src/rules.js`, `src/model.js`, `src/pipeline.js`)
- WhatsApp webhook: verify, receive, and send (`src/whatsapp.js`)
- Inbox with duplicate-message protection and approve/reject (`src/inbox.js`)
- Owner approval page (`src/ownerPage.js`, `src/server.js`)
- 37 automated tests (`test/`)

## Run it

You need Node.js 20 or newer.

1. Copy `.env.example` to `.env` and fill in your own values. Never commit `.env`.
2. Run the tests: `npm test`
3. Start the server: `node --env-file=.env src/server.js`
4. Open `http://localhost:3000/approvals?key=YOUR_OWNER_KEY`
5. For real WhatsApp messages, expose port 3000 with a tunnel and set the callback URL to `<tunnel>/webhook` in the Meta app dashboard.

## Current limits

- Drafts are kept in memory, so they reset when the server restarts.
- It runs on a WhatsApp test number, which can message up to 5 verified recipients.
- Free-form replies only work within 24 hours of the customer's last message (WhatsApp rule).
- Voice notes are not supported yet.

## License

MIT
