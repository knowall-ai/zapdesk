/**
 * Sanity check: can the mail app actually read + send for a given mailbox?
 * This catches Application Access Policy gaps before we redirect the poller.
 *
 * Usage: bun scripts/check-mailbox-access.ts <mailbox>
 */

const mailbox = process.argv[2];
if (!mailbox) {
  console.error('Usage: bun scripts/check-mailbox-access.ts <mailbox>');
  process.exit(1);
}

const tenant = process.env.MAIL_TENANT_ID || process.env.AZURE_AD_TENANT_ID;
const clientId = process.env.MAIL_CLIENT_ID || process.env.AZURE_AD_CLIENT_ID;
const clientSecret = process.env.MAIL_CLIENT_SECRET || process.env.AZURE_AD_CLIENT_SECRET;
if (!tenant || !clientId || !clientSecret) {
  console.error('MAIL_TENANT_ID / MAIL_CLIENT_ID / MAIL_CLIENT_SECRET must be set in .env.local');
  process.exit(1);
}

const tokenRes = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'client_credentials',
    scope: 'https://graph.microsoft.com/.default',
  }),
});
const tokenJson = await tokenRes.json();
if (!tokenRes.ok) {
  console.error('❌ Token request failed:', JSON.stringify(tokenJson, null, 2));
  process.exit(1);
}
const token = tokenJson.access_token;
console.log('✓ Token acquired');

// Read access — list one inbox message
const readUrl =
  `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/mailFolders('Inbox')/messages` +
  `?$top=1&$select=id,subject`;
const readRes = await fetch(readUrl, { headers: { Authorization: `Bearer ${token}` } });
const readBody = await readRes.text();
if (readRes.ok) {
  const json = JSON.parse(readBody) as { value: Array<{ subject?: string }> };
  console.log(
    `✓ Mail.ReadWrite OK — ${json.value.length === 0 ? 'inbox empty' : `latest: "${json.value[0].subject}"`}`
  );
} else {
  console.error(`❌ Mail.ReadWrite failed (${readRes.status}):`);
  console.error(readBody);
  console.error('\n→ Add the mailbox to your Application Access Policy:');
  console.error(`  New-ApplicationAccessPolicy -AppId ${clientId} \`\n` +
    `    -PolicyScopeGroupId ${mailbox} \`\n` +
    `    -AccessRight RestrictAccess \`\n` +
    `    -Description "ZapDesk — ${mailbox}"`);
  process.exit(1);
}

// Send access — Graph getMailFolders is the cheapest probe that exercises the
// same /users/{id}/ scope as sendMail without actually sending anything.
const probeUrl = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}?$select=mail,userPrincipalName,displayName`;
const probeRes = await fetch(probeUrl, { headers: { Authorization: `Bearer ${token}` } });
if (probeRes.ok) {
  const u = (await probeRes.json()) as {
    mail?: string;
    userPrincipalName?: string;
    displayName?: string;
  };
  console.log(
    `✓ Mailbox visible — ${u.displayName} <${u.mail || u.userPrincipalName}>`
  );
} else {
  console.warn(`⚠ Could not resolve user record (${probeRes.status}) — sendMail may still work, but check the mailbox identity.`);
}

console.log(`\nReady. Update .env.local:`);
console.log(`  MAIL_POLL_MAILBOX=${mailbox}`);
console.log(`  MAIL_FROM=${mailbox}`);
