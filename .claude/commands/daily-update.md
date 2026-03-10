# Daily Update Generator

Generate a formatted daily update for posting in Microsoft Teams.

## Instructions

1. **Get today's date** using the system date and format as: `Dth Month YYYY` (e.g. "9th March 2026")

2. **Scan all GitHub repos** under the `knowall-ai` organization for activity today:
   - Use `gh` CLI to find PRs updated/merged/opened today across ALL repos in the org
   - Use `gh` CLI to find issues updated/opened today across ALL repos in the org
   - Command: `gh search prs --owner=knowall-ai --updated=">=$(date +%Y-%m-%d)" --json repository,title,number,state,updatedAt --limit 50`
   - Command: `gh search issues --owner=knowall-ai --updated=">=$(date +%Y-%m-%d)" --json repository,title,number,state,updatedAt --limit 50`
   - Group by repo name, show PR/issue number, title, repo name in parentheses, and status [MERGED/OPEN/CLOSED]

3. **DevOps activity**: Check if user mentions any Azure DevOps activity. If none, show "No activity today."

4. **Comms Summary**: Ask the user to provide a brief comms summary (emails, meetings, follow-ups). If the user provides one, include it. If they say skip/none, show "No comms today."

5. **Format the output** exactly as below and present it for copy/paste:

```
📊 KnowAll Daily Update — <date> KnowAll AI - Internal

🔀 GITHUB
• PR #<number> — <title> (<repo-name>) [<STATUS>]
• Issue #<number> — <title> (<repo-name>) [<STATUS>]

🔧 DEVOPS
<devops activity or "No activity today.">

📧 COMMS SUMMARY
<comms text or "No comms today.">
```

## Rules

- Always scan ALL repos in the `knowall-ai` org, not just zapdesk
- For PRs: show MERGED if merged, OPEN if still open, CLOSED if closed without merge
- Sort PRs by repo name, then by PR number descending
- Sort issues by repo name, then by issue number descending
- If no GitHub activity found, show "No activity today." under the GITHUB section
- Do NOT fabricate any activity — only show what the `gh` CLI returns
- Present the final output as a single code block the user can copy
