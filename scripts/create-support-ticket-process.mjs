#!/usr/bin/env node

/**
 * Support Ticket process creator (#569)
 *
 * Creates an inherited Azure DevOps process whose states are ZapDesk's
 * statuses, one to one, and a `Ticket` work item type that uses them.
 *
 * ZapDesk shows a support desk's statuses, but every stock process template is
 * built for development work, so ZapDesk has to translate by state category.
 * That translation has cost real bugs: `Pending` is written as `Blocked` and
 * read back out of it, and `Open` and `In Progress` share a category in most
 * templates, so one of the two is always a guess.
 *
 * On this process there is nothing to guess.
 *
 * Usage:
 *   node scripts/create-support-ticket-process.mjs -o <org> [--parent Agile] [--dry-run]
 *
 * Required Arguments:
 *   --org, -o        Azure DevOps organization name
 *
 * Options:
 *   --parent         Process to inherit from (default: Agile)
 *   --name           Process name (default: "Support Ticket")
 *   --dry-run        Print what would be created and change nothing
 *
 * Environment Variables:
 *   AZURE_DEVOPS_PAT - a PAT whose owner can edit processes in the
 *                      organization. "Work Items (Read, Write)" is NOT enough:
 *                      process editing needs a user with the "Edit process"
 *                      permission at organization level.
 *
 * This script does NOT move any project onto the process. That rewrites the
 * states of every existing work item in the project, so it is left as a
 * deliberate step in the DevOps UI: Project settings -> Overview -> Process.
 */

const API = '7.0';

/**
 * The states, in workflow order.
 *
 * Kept in step with `SUPPORT_TICKET_STATES` in
 * src/config/process-templates/support-ticket.ts, which is what ZapDesk reads.
 * A test there checks that file against ZapDesk's own mapping; this list is
 * what puts the same states into DevOps.
 */
const STATES = [
  { name: 'New', category: 'Proposed', color: 'b2b2b2', order: 1 },
  { name: 'Open', category: 'InProgress', color: '007acc', order: 2 },
  { name: 'In Progress', category: 'InProgress', color: '007acc', order: 3 },
  { name: 'Pending', category: 'InProgress', color: 'f5a623', order: 4 },
  { name: 'Closed', category: 'Completed', color: '339933', order: 5 },
];

/** States the parent process brings that this one does not want. */
const UNWANTED = ['Active', 'Resolved', 'Doing', 'To Do', 'Committed', 'Approved', 'Done'];

function parseArgs() {
  const args = process.argv.slice(2);
  const result = { org: null, parent: 'Agile', name: 'Support Ticket', dryRun: false };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--org' || arg === '-o') result.org = args[++i];
    else if (arg === '--parent') result.parent = args[++i];
    else if (arg === '--name') result.name = args[++i];
    else if (arg === '--dry-run') result.dryRun = true;
    else if (arg === '--help' || arg === '-h') {
      console.log(
        'Usage: node scripts/create-support-ticket-process.mjs -o <org> [--parent Agile] [--name "Support Ticket"] [--dry-run]'
      );
      process.exit(0);
    }
  }

  if (!result.org) {
    console.error('Error: --org is required. See --help.');
    process.exit(1);
  }
  if (!process.env.AZURE_DEVOPS_PAT) {
    console.error('Error: AZURE_DEVOPS_PAT is not set.');
    process.exit(1);
  }
  return result;
}

function client(org) {
  const auth = Buffer.from(`:${process.env.AZURE_DEVOPS_PAT}`).toString('base64');
  const base = `https://dev.azure.com/${encodeURIComponent(org)}/_apis/work/processes`;

  return async function call(path, { method = 'GET', body } = {}) {
    const url = `${base}${path}${path.includes('?') ? '&' : '?'}api-version=${API}`;
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    const text = await response.text();
    if (!response.ok) {
      // The permission failure is the common one and reads as a bug unless
      // it says so: a PAT with Work Items (Read, Write) still cannot edit a
      // process.
      const hint =
        response.status === 401 || response.status === 403
          ? '\n  The PAT owner needs the "Edit process" permission at organization level.'
          : '';
      throw new Error(`${method} ${path} -> ${response.status} ${text}${hint}`);
    }
    return text ? JSON.parse(text) : null;
  };
}

async function main() {
  const { org, parent, name, dryRun } = parseArgs();
  const call = client(org);

  console.log(`Organization : ${org}`);
  console.log(`Process      : ${name} (inherits from ${parent})`);
  console.log(`Work item    : Ticket`);
  console.log(`States       : ${STATES.map((s) => s.name).join(' -> ')}`);
  if (dryRun) {
    console.log('\n--dry-run: nothing was created.');
    return;
  }

  const processes = await call('');
  const existing = (processes.value || []).find(
    (p) => (p.name || '').toLowerCase() === name.toLowerCase()
  );
  if (existing) {
    console.log(`\nProcess "${name}" already exists (${existing.typeId}). Nothing to do.`);
    console.log('Delete it in DevOps first if you want it rebuilt.');
    return;
  }

  const parentProcess = (processes.value || []).find(
    (p) => (p.name || '').toLowerCase() === parent.toLowerCase()
  );
  if (!parentProcess) {
    throw new Error(`Parent process "${parent}" not found in ${org}.`);
  }

  console.log('\nCreating the process...');
  const created = await call('', {
    method: 'POST',
    body: {
      name,
      parentProcessTypeId: parentProcess.typeId,
      description: "ZapDesk support tickets. Its states are ZapDesk's statuses.",
    },
  });
  console.log(`  created ${created.typeId}`);

  console.log('Creating the Ticket work item type...');
  const ticket = await call(`/${created.typeId}/workitemtypes`, {
    method: 'POST',
    body: {
      name: 'Ticket',
      description: 'A customer support ticket.',
      color: '22c55e',
      icon: 'icon_headphone',
      isDisabled: false,
    },
  });
  console.log(`  created ${ticket.referenceName}`);

  console.log('Adding the states...');
  for (const state of STATES) {
    await call(`/${created.typeId}/workitemtypes/${ticket.referenceName}/states`, {
      method: 'POST',
      body: {
        name: state.name,
        color: state.color,
        stateCategory: state.category,
        order: state.order,
      },
    });
    console.log(`  + ${state.name} (${state.category})`);
  }

  // After the wanted states, so the type is never left with none.
  console.log('Hiding the states this process does not use...');
  const current = await call(`/${created.typeId}/workitemtypes/${ticket.referenceName}/states`);
  for (const state of current.value || []) {
    if (!UNWANTED.includes(state.name)) continue;
    await call(`/${created.typeId}/workitemtypes/${ticket.referenceName}/states/${state.id}`, {
      method: 'PUT',
      body: { hidden: true },
    });
    console.log(`  - ${state.name}`);
  }

  console.log('\nDone.');
  console.log('Next, in the DevOps UI: Project settings -> Overview -> Process -> change process.');
  console.log('That rewrites the states of existing work items, so do it deliberately.');
}

main().catch((error) => {
  console.error(`\nFailed: ${error.message}`);
  process.exit(1);
});
