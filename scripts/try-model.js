// Try one customer message against the real model, then print the decision.
//   1. Copy .env.example to .env and put your BASETEN_API_KEY in it.
//   2. Run:  node --env-file=.env scripts/try-model.js "How much is knotless braids?"
import { readFileSync } from 'node:fs';
import { createBasetenClient } from '../src/model.js';
import { processCustomerMessage } from '../src/pipeline.js';

const message = process.argv.slice(2).join(' ').trim();
if (!message) {
  console.error('Usage: node --env-file=.env scripts/try-model.js "customer message"');
  process.exit(1);
}

const brain = JSON.parse(readFileSync(new URL('../data/demo-brain.json', import.meta.url), 'utf8'));
const client = createBasetenClient();
const result = await processCustomerMessage({ message, brain, client });

console.log(`Customer: ${message}\n`);
console.log(`Decision: ${result.status}`);
if (result.reason) console.log(`Reason: ${result.reason}`);
if (result.draft) console.log(`Draft reply: ${result.draft.reply}\nOffer: ${JSON.stringify(result.draft.offer)}`);
for (const v of result.violations) console.log(`${v.blocking ? 'BLOCKED' : 'Note'} [${v.code}]: ${v.message}`);
