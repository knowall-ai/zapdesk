/**
 * Quick diagnostic: which DevOps projects map a given email domain?
 * Run with:  bun scripts/check-domain-mapping.ts <domain>
 */

const domain = (process.argv[2] || '').toLowerCase().trim();
if (!domain) {
  console.error('Usage: bun scripts/check-domain-mapping.ts <domain>');
  process.exit(1);
}

const pat = process.env.AZURE_DEVOPS_PAT;
const org = process.env.AZURE_DEVOPS_ORG;
if (!pat || !org) {
  console.error('AZURE_DEVOPS_PAT and AZURE_DEVOPS_ORG must be set in .env.local');
  process.exit(1);
}

const auth = 'Basic ' + Buffer.from(':' + pat).toString('base64');
const res = await fetch(
  `https://dev.azure.com/${org}/_apis/projects?api-version=7.0&$top=500&stateFilter=wellFormed`,
  { headers: { Authorization: auth } }
);
if (!res.ok) {
  console.error(`DevOps list-projects failed: ${res.status} ${await res.text()}`);
  process.exit(1);
}
const data = (await res.json()) as { value: Array<{ name: string; description?: string }> };

const matches = data.value.filter((p) => {
  if (!p.description) return false;
  // Mirror src/lib/devops.ts parsing: looks for "Email: a.com, b.com" or "email=a.com"
  const m = p.description.match(/email[:\s=]+([\w.,\s-]+)/i);
  if (!m) return false;
  const domains = m[1]
    .split(/[,;\s]+/)
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
  return domains.includes(domain);
});

console.log(`Searched ${data.value.length} projects for domain "${domain}":`);
if (matches.length === 0) {
  console.log('  (none — add `Email: ' + domain + '` to a project description in DevOps)');
  // Help debugging: show any project whose description even mentions "email" so the user
  // can spot a typo in an existing mapping.
  const partial = data.value.filter((p) => p.description && /email/i.test(p.description));
  if (partial.length > 0) {
    console.log('\nProjects that mention "email" in their description (for reference):');
    for (const p of partial) console.log(`  • ${p.name}: ${p.description}`);
  }
} else {
  for (const p of matches) console.log(`  ✓ ${p.name}: ${p.description}`);
}
