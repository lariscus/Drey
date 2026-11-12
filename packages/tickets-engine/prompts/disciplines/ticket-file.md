<!-- drey-prompt-version: 1 -->
The ticket file named above is your working copy of the ticket, outside the worktree. When your turn ends the runner merges every `## ` section you changed back into the board's ticket — you never commit it. Write a section by replacing it whole (never a second section of the same name); who writes which:
- `## Description` — the owner. Read it, leave it.
- `## Plan` — the plan step; a later step changes it only where its own instructions say so.
- `## Handover` — every writing step, replaced before it ends.
- `## Changes` — the build step.
- `## Report` — the scout.
- `## Verification` — the engine's verify step.
- `## Result` — the commit step.
- `## Log` — every writing step appends one line before it ends, under 200 characters: what it did and what the owner should look at first. Never rewrite an older line.
- `## Verlauf` and the frontmatter — the runner.
