# ZapDesk Scripts

This directory contains utility scripts for the ZapDesk project.

## create-backlog.mjs

Creates a realistic backlog of work items in Azure DevOps for demo/testing purposes. Supports multiple process templates (Agile, Scrum, T-Minus-15) with template-specific work item types and hierarchies.

### Prerequisites

1. **Azure DevOps Personal Access Token (PAT)**
   - Go to https://dev.azure.com/{your-org}/_usersSettings/tokens
   - Click "New Token"
   - Set name: "ZapDesk Backlog Creator"
   - Set organization: Select your organization
   - Set expiration: Choose appropriate duration
   - Set scopes: **Work Items (Read, Write)**
   - Click "Create" and copy the token

2. **Environment Variable**
   Set your Personal Access Token as an environment variable:

   ```bash
   export AZURE_DEVOPS_PAT="your_personal_access_token_here"
   ```

   Or add to `.env.local` in the project root:

   ```bash
   AZURE_DEVOPS_PAT=your_personal_access_token_here
   ```

### Supported Templates

| Template       | Work Item Hierarchy                         | File                         |
| -------------- | ------------------------------------------- | ---------------------------- |
| **Agile**      | Epic → Feature → User Story → Task/Bug      | `dummy-agile-backlog.mjs`    |
| **Scrum**      | Epic → Feature → PBI → Task/Bug/Impediment  | `dummy-scrum-backlog.mjs`    |
| **T-Minus-15** | Epic → Feature → Task/Bug/Enhancement/Issue | `dummy-tminus15-backlog.mjs` |

### Usage

**Set up PAT** (in `.env.local` or export directly):

```bash
export AZURE_DEVOPS_PAT="your_token_here"
```

**Dry Run (Preview)** - See what would be created:

```bash
node scripts/create-backlog.mjs -o KnowAllTest -p "ABC Inc (Agile)" -t agile --dry-run
```

**Create Backlog** - Actually create the work items:

```bash
node scripts/create-backlog.mjs -o KnowAllTest -p "ABC Inc (Agile)" -t agile
```

**Delete and Recreate** - Remove all existing dummy items and recreate fresh:

```bash
node scripts/create-backlog.mjs -o KnowAllTest -p "ABC Inc (Agile)" -t agile --delete-existing
```

**Show Help:**

```bash
node scripts/create-backlog.mjs --help
```

### Upsert Behavior

The script uses GUID markers embedded in work item descriptions for reliable matching:

```html
<!-- BACKLOG-GUID:abc123-def456-... -->
```

- **Matching**: Work items are matched by GUID marker in description
- **Update**: If a matching GUID is found, the existing item is updated
- **Create**: If no match is found, a new work item is created with a new GUID
- **State**: Items are created in "New" state, then transitioned to target state (Azure DevOps doesn't allow creating directly in Closed/Active state)

This allows you to safely re-run the script to:

- Add new work items to an existing backlog
- Update descriptions, priorities, or effort estimates
- Maintain consistent item identity across runs

### What Gets Created

The Agile backlog creates a Website Support Epic with 12 monthly blocks (~243 items):

```
Website Support (Epic)
├── Support Setup (Feature) - Enabler
│   └── User Story with setup tasks
├── Block 1-3: Completed months (Features) - Closed state
│   └── "As a user, I want to be supported" (User Story)
│       └── 35-40 support tickets each (Tasks, Bugs, User Stories)
├── Block 4: Current month (Feature) - Active state
│   └── User Story with ~5 active tickets
└── Block 5-12: Future months (Features) - New state
    └── Monthly checkpoint tasks only
```

**Tagging:**

- All items tagged with `dummy` for identification
- Only support tickets tagged with `ticket` (appear in ZapDesk)
- Website build items are NOT tagged with `ticket`

**States:**

- Blocks 1-3: Closed (completed work)
- Block 4: Active (current work)
- Blocks 5-12: New (future work)

### Output

The script will display progress as it creates items:

```
🚀 Azure DevOps Backlog Creator

Template: Agile
Organization: KnowAllTest
Project: ABC Inc (Agile)
Top-level items: 3
Total work items: 170

Creating backlog items...

Creating Epic: Corporate Website Launch
✓ Created Epic #100: Corporate Website Launch
  Creating Feature: Website Foundation & Infrastructure
  ✓ Created Feature #101: Website Foundation & Infrastructure
    Creating User Story: Set up development environment and tooling
    ✓ Created User Story #102: Set up development environment and tooling
      Creating Task: Configure Next.js project with TypeScript
      ✓ Created Task #103: Configure Next.js project with TypeScript
      ...
```

After completion, you can view the backlog at:

```
https://dev.azure.com/{your-org}/{your-project}/_workitems
```

### Troubleshooting

**Authentication Error**

- Verify your PAT is correct and not expired
- Ensure the PAT has "Work Items (Read, Write)" scope
- Check that the organization name is correct

**Project Not Found**

- Verify the project name exactly matches (case-sensitive)
- Ensure your PAT has access to the project
- Check that you have permissions to create work items in the project

**Work Item Type Not Found**

- Ensure your project uses the correct process template for the backlog you're creating
- Agile backlog requires Agile template
- Scrum backlog requires Scrum template
- T-Minus-15 backlog requires T-Minus-15 template

**Backlog File Not Found**

- Ensure the corresponding backlog file exists (e.g., `dummy-agile-backlog.mjs`)
- Some templates may not have backlog data created yet

### Customization

To modify the backlog content, edit the corresponding backlog file:

- `scripts/dummy-agile-backlog.mjs` - Agile template
- `scripts/dummy-scrum-backlog.mjs` - Scrum template
- `scripts/dummy-tminus15-backlog.mjs` - T-Minus-15 template

The data structure is:

```javascript
{
  type: 'Epic',  // or 'Feature', 'User Story', 'Task', 'Bug', etc.
  title: 'Epic title',
  description: 'HTML-formatted description',
  priority: 1,  // 1=Urgent, 2=High, 3=Normal, 4=Low
  tags: ['ticket', 'other-tags'],
  storyPoints: 5,  // For User Stories/PBIs
  remainingWork: 8,  // For Tasks (hours)
  children: [...]  // Nested work items
}
```

### Safety

- The script includes a `--dry-run` mode to preview changes
- Always test with dry-run first before creating items
- Work items can be deleted from Azure DevOps if needed
- Consider using a test project for initial testing

## Backlog Files

| File                         | Description                                          | Status      |
| ---------------------------- | ---------------------------------------------------- | ----------- |
| `dummy-agile-backlog.mjs`    | Corporate marketing website backlog (Agile template) | ✅ Complete |
| `dummy-scrum-backlog.mjs`    | Software development backlog (Scrum template)        | 📝 Planned  |
| `dummy-tminus15-backlog.mjs` | Software development backlog (T-Minus-15 template)   | 📝 Planned  |

## Other Scripts

- `generate-icons.mjs` - Generate icon assets
- `generate-logo.js` - Generate logo assets
