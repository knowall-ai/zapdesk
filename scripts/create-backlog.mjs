#!/usr/bin/env node

/**
 * Azure DevOps Backlog Creator
 *
 * Creates a realistic backlog of Epics, Features, User Stories, Tasks, and Bugs
 * in Azure DevOps with proper hierarchical relationships.
 *
 * Supports multiple process templates (Agile, Scrum, T-Minus-15) with template-specific
 * work item types and hierarchies.
 *
 * Usage:
 *   node scripts/create-backlog.mjs -o <org> -p <project> -t <template> [options]
 *
 * Required Arguments:
 *   --org, -o        Azure DevOps organization name
 *   --project, -p    Azure DevOps project name
 *   --template, -t   Process template (agile, scrum, tminus15)
 *
 * Environment Variables:
 *   AZURE_DEVOPS_PAT - Personal Access Token with Work Items (Read, Write) permission
 */

import { randomUUID } from 'crypto';

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const result = {
    template: null,
    org: null,
    project: null,
    dryRun: false,
    assignUsers: false,
    deleteExisting: false,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--template' || args[i] === '-t') {
      result.template = args[i + 1];
      i++;
    } else if (args[i] === '--org' || args[i] === '-o') {
      result.org = args[i + 1];
      i++;
    } else if (args[i] === '--project' || args[i] === '-p') {
      result.project = args[i + 1];
      i++;
    } else if (args[i] === '--dry-run') {
      result.dryRun = true;
    } else if (args[i] === '--assign-users') {
      result.assignUsers = true;
    } else if (args[i] === '--delete-existing') {
      result.deleteExisting = true;
    } else if (args[i] === '--help' || args[i] === '-h') {
      result.help = true;
    }
  }

  return result;
}

// Show usage help
function showHelp() {
  console.log(`
Azure DevOps Backlog Creator

Usage:
  node scripts/create-backlog.mjs --org <org> --project <project> --template <template> [options]

Templates:
  agile      Create Agile backlog (Epic → Feature → User Story → Task/Bug)
  scrum      Create Scrum backlog (Epic → Feature → PBI → Task/Bug/Impediment)
  tminus15   Create T-Minus-15 backlog (Epic → Feature → Task/Bug/Enhancement/Issue)

Options:
  --org, -o <name>        Required. Azure DevOps organization name
  --project, -p <name>    Required. Azure DevOps project name
  --template, -t <name>   Required. Specify the process template
  --dry-run               Preview changes without creating work items
  --assign-users          Randomly assign work items to project team members
  --delete-existing       Delete all existing work items with backlog GUIDs before creating
  --help, -h              Show this help message

Environment Variables:
  AZURE_DEVOPS_PAT        Personal Access Token with Work Items (Read, Write) scope

Examples:
  node scripts/create-backlog.mjs -o KnowAllTest -p "ABC Inc (Agile)" -t agile
  node scripts/create-backlog.mjs --org KnowAllTest --project "DEF Inc (Scrum)" --template scrum
  node scripts/create-backlog.mjs -o KnowAllTest -p "ABC Inc (Agile)" -t agile --assign-users
  node scripts/create-backlog.mjs -o KnowAllTest -p "ABC Inc (Agile)" -t agile --dry-run
`);
}

// Template configuration
const TEMPLATE_CONFIG = {
  agile: {
    name: 'Agile',
    backlogFile: './dummy-agile-backlog.mjs',
  },
  scrum: {
    name: 'Scrum',
    backlogFile: './dummy-scrum-backlog.mjs',
  },
  tminus15: {
    name: 'T-Minus-15',
    backlogFile: './dummy-tminus15-backlog.mjs',
  },
};

const args = parseArgs();

if (args.help) {
  showHelp();
  process.exit(0);
}

// Validate required arguments
const missingArgs = [];
if (!args.org) missingArgs.push('--org');
if (!args.project) missingArgs.push('--project');
if (!args.template) missingArgs.push('--template');

if (missingArgs.length > 0) {
  console.error(`❌ Error: Missing required arguments: ${missingArgs.join(', ')}\n`);
  showHelp();
  process.exit(1);
}

const templateKey = args.template.toLowerCase();
if (!TEMPLATE_CONFIG[templateKey]) {
  console.error(`❌ Error: Unknown template "${args.template}"`);
  console.error(`   Valid templates: ${Object.keys(TEMPLATE_CONFIG).join(', ')}`);
  process.exit(1);
}

const templateConfig = TEMPLATE_CONFIG[templateKey];

// Configuration from command-line args and environment variables
const ORG = args.org;
const PROJECT = args.project;
const PAT = process.env.AZURE_DEVOPS_PAT;
const BASE_URL = `https://dev.azure.com/${ORG}`;
const API_VERSION = '7.0';

// Check for mode flags
const isDryRun = args.dryRun;
const shouldAssignUsers = args.assignUsers;
const shouldDeleteExisting = args.deleteExisting;

// GUID marker for identifying backlog-created items
const GUID_MARKER = '<!-- BACKLOG-GUID:';
const GUID_MARKER_END = ' -->';

// Cache for team members (fetched once on first use)
let teamMembersCache = null;

// Cache for existing work items (fetched once per run)
let existingWorkItemsCache = null;

// Validate PAT environment variable (only required for actual execution, not dry-run)
function validateConfig() {
  if (!PAT && !isDryRun) {
    console.error('❌ Missing AZURE_DEVOPS_PAT environment variable');
    console.error('\nSet your Personal Access Token:');
    console.error('  export AZURE_DEVOPS_PAT="your_token_here"');
    console.error('\nGet a PAT from: https://dev.azure.com/{org}/_usersSettings/tokens');
    process.exit(1);
  }
}

// Dynamically load backlog data for selected template
async function loadBacklogData() {
  try {
    const backlogModule = await import(templateConfig.backlogFile);
    return backlogModule.backlogData;
  } catch (error) {
    if (error.code === 'ERR_MODULE_NOT_FOUND') {
      console.error(`❌ Backlog file not found: ${templateConfig.backlogFile}`);
      console.error(`   The ${templateConfig.name} backlog data file may not exist yet.`);
    } else {
      console.error(`❌ Error loading backlog data: ${error.message}`);
    }
    process.exit(1);
  }
}

// Create authorization header with PAT
function getAuthHeader() {
  const token = Buffer.from(`:${PAT}`).toString('base64');
  return `Basic ${token}`;
}

// Fetch team members from the project
async function fetchTeamMembers() {
  if (teamMembersCache !== null) {
    return teamMembersCache;
  }

  console.log('📋 Fetching team members for random assignment...');

  try {
    // First, get all teams in the project
    const teamsUrl = `${BASE_URL}/_apis/projects/${encodeURIComponent(PROJECT)}/teams?api-version=${API_VERSION}`;
    const teamsResponse = await fetch(teamsUrl, {
      headers: { Authorization: getAuthHeader() },
    });

    if (!teamsResponse.ok) {
      console.warn('⚠️  Could not fetch teams, skipping user assignment');
      teamMembersCache = [];
      return [];
    }

    const teamsData = await teamsResponse.json();
    const allMembers = [];

    // Get members from each team
    for (const team of teamsData.value || []) {
      const membersUrl = `${BASE_URL}/_apis/projects/${encodeURIComponent(PROJECT)}/teams/${encodeURIComponent(team.id)}/members?api-version=${API_VERSION}`;
      const membersResponse = await fetch(membersUrl, {
        headers: { Authorization: getAuthHeader() },
      });

      if (membersResponse.ok) {
        const membersData = await membersResponse.json();
        for (const member of membersData.value || []) {
          // Avoid duplicates (user might be in multiple teams)
          const identity = member.identity;
          if (identity && !allMembers.find((m) => m.uniqueName === identity.uniqueName)) {
            allMembers.push({
              displayName: identity.displayName,
              uniqueName: identity.uniqueName,
              id: identity.id,
            });
          }
        }
      }
    }

    teamMembersCache = allMembers;
    console.log(
      `   Found ${allMembers.length} team members: ${allMembers.map((m) => m.displayName).join(', ')}`
    );
    return allMembers;
  } catch (error) {
    console.warn(`⚠️  Error fetching team members: ${error.message}`);
    teamMembersCache = [];
    return [];
  }
}

// Get a random team member
function getRandomTeamMember(teamMembers) {
  if (!teamMembers || teamMembers.length === 0) {
    return null;
  }
  const randomIndex = Math.floor(Math.random() * teamMembers.length);
  return teamMembers[randomIndex];
}

// Extract GUID from description
function extractGuidFromDescription(description) {
  if (!description) return null;
  const startIdx = description.indexOf(GUID_MARKER);
  if (startIdx === -1) return null;
  const guidStart = startIdx + GUID_MARKER.length;
  const endIdx = description.indexOf(GUID_MARKER_END, guidStart);
  if (endIdx === -1) return null;
  return description.substring(guidStart, endIdx).trim();
}

// Add GUID to description
function addGuidToDescription(description, guid) {
  return `${description}\n\n${GUID_MARKER}${guid}${GUID_MARKER_END}`;
}

// Fetch all existing work items created by this backlog script (have GUID marker)
async function fetchExistingWorkItems() {
  if (existingWorkItemsCache !== null) {
    return existingWorkItemsCache;
  }

  console.log('🔍 Fetching existing work items for upsert matching...');

  try {
    // Use WIQL to query for all work items with GUID marker in description
    const wiqlUrl = `${BASE_URL}/${encodeURIComponent(PROJECT)}/_apis/wit/wiql?api-version=${API_VERSION}`;
    const wiqlQuery = {
      query: `SELECT [System.Id], [System.Title], [System.WorkItemType], [System.Description]
              FROM WorkItems
              WHERE [System.TeamProject] = '${PROJECT}'
              AND [System.Description] CONTAINS 'BACKLOG-GUID:'`,
    };

    const response = await fetch(wiqlUrl, {
      method: 'POST',
      headers: {
        Authorization: getAuthHeader(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(wiqlQuery),
    });

    if (!response.ok) {
      console.warn('⚠️  Could not fetch existing work items, will create new items');
      existingWorkItemsCache = [];
      return [];
    }

    const data = await response.json();
    const workItemIds = data.workItems?.map((wi) => wi.id) || [];

    if (workItemIds.length === 0) {
      console.log('   No existing work items found with backlog GUIDs');
      existingWorkItemsCache = [];
      return [];
    }

    // Fetch work item details in batches of 200
    const allWorkItems = [];
    for (let i = 0; i < workItemIds.length; i += 200) {
      const batchIds = workItemIds.slice(i, i + 200);
      const detailsUrl = `${BASE_URL}/${encodeURIComponent(PROJECT)}/_apis/wit/workitems?ids=${batchIds.join(',')}&fields=System.Id,System.Title,System.WorkItemType,System.Description&api-version=${API_VERSION}`;

      const detailsResponse = await fetch(detailsUrl, {
        headers: { Authorization: getAuthHeader() },
      });

      if (detailsResponse.ok) {
        const detailsData = await detailsResponse.json();
        allWorkItems.push(...(detailsData.value || []));
      }
    }

    existingWorkItemsCache = allWorkItems
      .map((wi) => ({
        id: wi.id,
        title: wi.fields['System.Title'],
        type: wi.fields['System.WorkItemType'],
        guid: extractGuidFromDescription(wi.fields['System.Description']),
      }))
      .filter((wi) => wi.guid); // Only keep items with valid GUIDs

    console.log(`   Found ${existingWorkItemsCache.length} existing work items with backlog GUIDs`);
    return existingWorkItemsCache;
  } catch (error) {
    console.warn(`⚠️  Error fetching existing work items: ${error.message}`);
    existingWorkItemsCache = [];
    return [];
  }
}

// Find an existing work item by GUID
function findExistingWorkItem(guid, existingItems) {
  if (!guid) return null;
  return existingItems.find((item) => item.guid === guid);
}

// Update an existing work item
async function updateWorkItem(
  workItemId,
  workItemType,
  title,
  description,
  priority,
  tags,
  remainingWork,
  storyPoints,
  _parentId = null,
  assignee = null
) {
  const patchDocument = [
    { op: 'replace', path: '/fields/System.Title', value: title },
    { op: 'replace', path: '/fields/System.Description', value: description },
    { op: 'replace', path: '/fields/System.Tags', value: tags.join('; ') },
  ];

  // Add assignee if specified
  if (assignee) {
    patchDocument.push({
      op: 'replace',
      path: '/fields/System.AssignedTo',
      value: assignee.uniqueName,
    });
  }

  // Add priority if specified
  if (priority) {
    patchDocument.push({
      op: 'replace',
      path: '/fields/Microsoft.VSTS.Common.Priority',
      value: priority,
    });
  }

  // Add effort fields for Tasks
  if (remainingWork) {
    const buffer = 1 + (Math.random() * 0.2 + 0.1);
    const originalEstimate = Math.round(remainingWork * buffer * 10) / 10;
    const completedRatio = Math.random() * 0.3;
    const completedWork = Math.round(remainingWork * completedRatio * 10) / 10;
    const adjustedRemaining = Math.round((originalEstimate - completedWork) * 10) / 10;

    patchDocument.push({
      op: 'replace',
      path: '/fields/Microsoft.VSTS.Scheduling.OriginalEstimate',
      value: originalEstimate,
    });
    patchDocument.push({
      op: 'replace',
      path: '/fields/Microsoft.VSTS.Scheduling.RemainingWork',
      value: adjustedRemaining,
    });
    patchDocument.push({
      op: 'replace',
      path: '/fields/Microsoft.VSTS.Scheduling.CompletedWork',
      value: completedWork,
    });
  }

  // Add story points for User Stories
  if (storyPoints) {
    patchDocument.push({
      op: 'replace',
      path: '/fields/Microsoft.VSTS.Scheduling.StoryPoints',
      value: storyPoints,
    });
  }

  // Note: We don't update parent links for existing items to avoid breaking hierarchies

  const url = `${BASE_URL}/${encodeURIComponent(PROJECT)}/_apis/wit/workitems/${workItemId}?api-version=${API_VERSION}`;

  const response = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: getAuthHeader(),
      'Content-Type': 'application/json-patch+json',
    },
    body: JSON.stringify(patchDocument),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to update ${workItemType} #${workItemId} "${title}": ${response.statusText} - ${errorText}`
    );
  }

  return response.json();
}

// Update work item state (for transitioning to Closed/Resolved after creation)
async function updateWorkItemState(workItemId, state) {
  const patchDocument = [{ op: 'add', path: '/fields/System.State', value: state }];

  const url = `${BASE_URL}/${encodeURIComponent(PROJECT)}/_apis/wit/workitems/${workItemId}?api-version=${API_VERSION}`;

  const response = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: getAuthHeader(),
      'Content-Type': 'application/json-patch+json',
    },
    body: JSON.stringify(patchDocument),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to update state for #${workItemId}: ${response.statusText} - ${errorText}`
    );
  }

  return response.json();
}

// Delete a work item
async function deleteWorkItem(workItemId) {
  const url = `${BASE_URL}/${encodeURIComponent(PROJECT)}/_apis/wit/workitems/${workItemId}?api-version=${API_VERSION}`;

  const response = await fetch(url, {
    method: 'DELETE',
    headers: {
      Authorization: getAuthHeader(),
    },
  });

  if (!response.ok && response.status !== 204) {
    const errorText = await response.text();
    throw new Error(
      `Failed to delete work item #${workItemId}: ${response.statusText} - ${errorText}`
    );
  }

  return true;
}

// Delete all existing work items with backlog GUIDs
async function deleteExistingWorkItems(existingItems) {
  if (existingItems.length === 0) {
    console.log('   No existing work items to delete');
    return 0;
  }

  console.log(`🗑️  Deleting ${existingItems.length} existing work items...`);
  let deleted = 0;
  let errors = 0;

  for (const item of existingItems) {
    try {
      await deleteWorkItem(item.id);
      console.log(`   ✓ Deleted ${item.type} #${item.id}: ${item.title}`);
      deleted++;
    } catch (error) {
      console.error(`   ✗ Failed to delete #${item.id}: ${error.message}`);
      errors++;
    }
  }

  console.log(`   Deleted: ${deleted}, Errors: ${errors}\n`);
  return deleted;
}

// Create a work item in Azure DevOps
async function createWorkItem(
  workItemType,
  title,
  description,
  priority,
  tags,
  remainingWork,
  storyPoints,
  state,
  guid,
  parentId = null,
  assignee = null
) {
  // Ensure "dummy" tag is always included, and add GUID to description
  const allTags = [...new Set([...tags, 'dummy'])];
  const descriptionWithGuid = addGuidToDescription(description, guid);

  const patchDocument = [
    { op: 'add', path: '/fields/System.Title', value: title },
    { op: 'add', path: '/fields/System.Description', value: descriptionWithGuid },
    { op: 'add', path: '/fields/System.Tags', value: allTags.join('; ') },
  ];

  // Don't set state on creation - items are created in "New" state
  // State transitions happen after creation via updateWorkItemState()

  // Add assignee if specified
  if (assignee) {
    patchDocument.push({
      op: 'add',
      path: '/fields/System.AssignedTo',
      value: assignee.uniqueName,
    });
  }

  // Add priority if specified (not available in Basic template)
  if (priority) {
    patchDocument.push({
      op: 'add',
      path: '/fields/Microsoft.VSTS.Common.Priority',
      value: priority,
    });
  }

  // Add effort fields for Tasks (Original Estimate, Remaining Work, Completed Work)
  if (remainingWork) {
    // Original Estimate: slightly higher than remaining (10-30% buffer)
    const buffer = 1 + (Math.random() * 0.2 + 0.1); // 1.1 to 1.3
    const originalEstimate = Math.round(remainingWork * buffer * 10) / 10;

    // Completed Work: random 0-30% of original for some realism
    const completedRatio = Math.random() * 0.3;
    const completedWork = Math.round(remainingWork * completedRatio * 10) / 10;

    // Remaining = Original - Completed (adjusted)
    const adjustedRemaining = Math.round((originalEstimate - completedWork) * 10) / 10;

    patchDocument.push({
      op: 'add',
      path: '/fields/Microsoft.VSTS.Scheduling.OriginalEstimate',
      value: originalEstimate,
    });
    patchDocument.push({
      op: 'add',
      path: '/fields/Microsoft.VSTS.Scheduling.RemainingWork',
      value: adjustedRemaining,
    });
    patchDocument.push({
      op: 'add',
      path: '/fields/Microsoft.VSTS.Scheduling.CompletedWork',
      value: completedWork,
    });
  }

  // Add story points for User Stories
  if (storyPoints) {
    patchDocument.push({
      op: 'add',
      path: '/fields/Microsoft.VSTS.Scheduling.StoryPoints',
      value: storyPoints,
    });
  }

  // Add parent link if specified
  if (parentId) {
    patchDocument.push({
      op: 'add',
      path: '/relations/-',
      value: {
        rel: 'System.LinkTypes.Hierarchy-Reverse',
        url: `${BASE_URL}/_apis/wit/workItems/${parentId}`,
      },
    });
  }

  const url = `${BASE_URL}/${encodeURIComponent(PROJECT)}/_apis/wit/workitems/$${encodeURIComponent(workItemType)}?api-version=${API_VERSION}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: getAuthHeader(),
      'Content-Type': 'application/json-patch+json',
    },
    body: JSON.stringify(patchDocument),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to create ${workItemType} "${title}": ${response.statusText} - ${errorText}`
    );
  }

  return response.json();
}

// Process a work item and its children recursively
async function processWorkItem(
  item,
  parentId = null,
  depth = 0,
  teamMembers = [],
  existingItems = []
) {
  const indent = '  '.repeat(depth);

  // Generate GUID if not present
  const guid = item.guid || randomUUID();

  try {
    // Get a random assignee if user assignment is enabled
    const assignee = shouldAssignUsers ? getRandomTeamMember(teamMembers) : null;
    const assigneeInfo = assignee ? ` → ${assignee.displayName}` : '';

    // Check if this work item already exists by GUID
    const existingItem = findExistingWorkItem(guid, existingItems);

    let workItem;
    let workItemId;

    if (existingItem) {
      // Update existing work item
      if (isDryRun) {
        console.log(
          `${indent}[DRY RUN] Would update ${item.type} #${existingItem.id}: ${item.title}${assigneeInfo}`
        );
        workItemId = existingItem.id;
        workItem = { id: workItemId };
      } else {
        console.log(
          `${indent}Updating ${item.type} #${existingItem.id}: ${item.title}${assigneeInfo}`
        );
        workItem = await updateWorkItem(
          existingItem.id,
          item.type,
          item.title,
          item.description || '',
          item.priority,
          item.tags || [],
          item.remainingWork,
          item.storyPoints,
          parentId,
          assignee
        );
        workItemId = workItem.id;
        console.log(`${indent}✓ Updated ${item.type} #${workItemId}: ${item.title}`);
      }
    } else {
      // Create new work item
      if (isDryRun) {
        console.log(`${indent}[DRY RUN] Would create ${item.type}: ${item.title}${assigneeInfo}`);
        if (parentId) {
          console.log(`${indent}          Parent: ${parentId}`);
        }
        workItemId = Math.floor(Math.random() * 10000);
        workItem = { id: workItemId };
      } else {
        console.log(`${indent}Creating ${item.type}: ${item.title}${assigneeInfo}`);
        workItem = await createWorkItem(
          item.type,
          item.title,
          item.description || '',
          item.priority,
          item.tags || [],
          item.remainingWork,
          item.storyPoints,
          item.state,
          guid,
          parentId,
          assignee
        );
        workItemId = workItem.id;
        console.log(`${indent}✓ Created ${item.type} #${workItemId}: ${item.title}`);

        // Transition to non-New state if needed (can't set on creation)
        if (item.state && item.state !== 'New') {
          try {
            await updateWorkItemState(workItemId, item.state);
            console.log(`${indent}  → State: ${item.state}`);
          } catch (stateError) {
            console.log(
              `${indent}  ⚠ Could not set state to ${item.state}: ${stateError.message.substring(0, 50)}...`
            );
          }
        }
      }
    }

    // Process children if they exist
    if (item.children && item.children.length > 0) {
      for (const child of item.children) {
        await processWorkItem(child, workItemId, depth + 1, teamMembers, existingItems);
      }
    }

    return { workItem, wasUpdated: !!existingItem };
  } catch (error) {
    console.error(`${indent}✗ Error processing ${item.type} "${item.title}":`, error.message);
    throw error;
  }
}

// Count all work items recursively
function countWorkItems(item) {
  let count = 1;
  if (item.children) {
    for (const child of item.children) {
      count += countWorkItems(child);
    }
  }
  return count;
}

// Main execution
async function main() {
  console.log('🚀 Azure DevOps Backlog Creator\n');

  if (isDryRun) {
    console.log('🔍 DRY RUN MODE - No work items will be created\n');
  }

  validateConfig();

  // Load backlog data for selected template
  const backlogData = await loadBacklogData();

  // Count total items
  let totalItems = 0;
  for (const item of backlogData) {
    totalItems += countWorkItems(item);
  }

  console.log(`Template: ${templateConfig.name}`);
  console.log(`Organization: ${ORG}`);
  console.log(`Project: ${PROJECT}`);
  console.log(`Top-level items: ${backlogData.length}`);
  console.log(`Total work items: ${totalItems}`);
  console.log(`Assign users: ${shouldAssignUsers ? 'Yes' : 'No'}`);
  console.log(`Delete existing: ${shouldDeleteExisting ? 'Yes' : 'No'}\n`);

  // Fetch team members if user assignment is enabled
  let teamMembers = [];
  if (shouldAssignUsers && !isDryRun) {
    teamMembers = await fetchTeamMembers();
    if (teamMembers.length === 0) {
      console.log('⚠️  No team members found, continuing without user assignment\n');
    } else {
      console.log('');
    }
  } else if (shouldAssignUsers && isDryRun) {
    console.log('📋 (Dry run: would fetch team members and assign randomly)\n');
  }

  // Fetch existing work items for upsert matching or deletion
  let existingItems = [];
  if (!isDryRun) {
    existingItems = await fetchExistingWorkItems();

    // Delete existing items if requested
    if (shouldDeleteExisting && existingItems.length > 0) {
      await deleteExistingWorkItems(existingItems);
      existingItems = []; // Clear cache so we create fresh items
      existingWorkItemsCache = null;
    } else {
      console.log('');
    }
  } else if (shouldDeleteExisting) {
    console.log('📋 (Dry run: would delete existing work items with backlog GUIDs)\n');
  }

  let totalCreated = 0;
  let totalUpdated = 0;
  let totalErrors = 0;

  console.log('Processing backlog items...\n');

  for (const item of backlogData) {
    try {
      await processWorkItem(item, null, 0, teamMembers, existingItems);
      totalCreated += countWorkItems(item);

      console.log(''); // Add spacing between top-level items
    } catch (error) {
      totalErrors++;
      console.error(`Failed to process item: ${error.message}\n`);
    }
  }

  // Count existing items that were updated vs created
  if (!isDryRun && existingItems.length > 0) {
    // Re-count based on what we actually did
    totalUpdated = existingItems.length;
    totalCreated = totalCreated - totalUpdated;
    if (totalCreated < 0) totalCreated = 0;
  }

  console.log('\n' + '='.repeat(60));
  if (isDryRun) {
    console.log(`\n✓ Dry run complete!`);
    console.log(`  Would process ${totalCreated} work items`);
  } else {
    console.log(`\n✓ Backlog sync complete!`);
    if (totalUpdated > 0) {
      console.log(`  Updated: ${totalUpdated} existing work items`);
    }
    if (totalCreated > 0) {
      console.log(`  Created: ${totalCreated} new work items`);
    }
    if (totalUpdated === 0 && totalCreated === 0) {
      console.log(`  No changes made`);
    }
    console.log(`  Errors: ${totalErrors}`);
    console.log(`\n  View in Azure DevOps:`);
    console.log(`  https://dev.azure.com/${ORG}/${encodeURIComponent(PROJECT)}/_workitems`);
  }
  console.log('');
}

// Run the script
main().catch((error) => {
  console.error('\n❌ Fatal error:', error.message);
  process.exit(1);
});
