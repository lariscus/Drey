<!-- drey-prompt-version: 1 -->
The plan format — the body of the ticket's `## Plan`, these chapters in this order:
- `### Goal` — what the ticket delivers and why, two or three sentences.
- `### Architecture` — a mermaid block, only when components or flows change.
- `### Decisions` — each settled choice with a one-line reason, plus tempting alternatives rejected; the owner's choices go here. "none" when there are none.
- `### Out of scope` — what the work must leave alone. "none" when nothing.
- `### Parts` — only when the work splits into two or more parts that ship and test on their own: one `- [ ] <title>` per part in execution order, each with detail lines indented two spaces — `persona: <id>`, `size: S|M|L` (how demanding: S light, M everyday, L hard; it picks the model class, S → C, M → B, L → A), `reason: <one line>`, optionally `chain: <entries separated by ;>`.
- `### Acceptance criteria` — one line per check, exactly `` - [ ] `<command>` `` at the start of the line: the machine gate runs the backticked command and nothing else, and drops a line without one. Each command runs non-interactively, exits non-zero while the work is missing, covers the ticket's behaviour (not only compilation), and can pass once the work is done — the file, folder or scope it names exists, in the form its runner takes (a runner that takes a plugin id or a path fragment takes no spec file path). At least one command: without one the gate refuses the ticket.
- `### Open questions` — only what the owner must still answer.

Name touching points by symbol or file name, never by line number: lines age before the build runs.
