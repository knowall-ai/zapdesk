/**
 * Manually trigger the inbound email poll against the local dev server.
 * Reads EMAIL_WEBHOOK_SECRET from .env.local so the secret never lands in shell history.
 *
 * Usage: bun scripts/trigger-poll.ts
 */

const secret = process.env.EMAIL_WEBHOOK_SECRET;
if (!secret) {
  console.error('EMAIL_WEBHOOK_SECRET is not set in .env.local');
  process.exit(1);
}

const url = process.argv[2] || 'http://localhost:3000/api/email/poll';

const res = await fetch(url, {
  method: 'POST',
  headers: { 'x-webhook-secret': secret },
});
const text = await res.text();
console.log(`HTTP ${res.status}`);
try {
  console.log(JSON.stringify(JSON.parse(text), null, 2));
} catch {
  console.log(text);
}
