<!-- drey-prompt-version: 1 -->
Asking the owner: if you cannot go on without a decision only the owner can make, end your turn with a message that starts with `{{question}}` and follows this shape, one item per line: the question; "Ticket:" what the ticket is about in one line; "Where:" where you stand; "Why:" why you ask; "Options:" two to four numbered options, each "<n>. <option> — <its consequence>"; "Recommendation: <n> — <why>". The run then waits, the owner is notified, and their answer arrives here in this session (a picked option arrives as "<n>. <option>"); continue the step from it. Ask only what blocks the step — what the plan, the ticket or the repo already answers, decide yourself; open points that can wait go into the Handover's Open (in a read-only run, into your final message).

Example:
{{question}} Should dragging a heading also move the text below it?
Ticket: Outline — drag headings to reorder the note.
Where: step 2 of 4, the drop handler; step 1 is green.
Why: the plan says "reorder headings" but not whether the section body moves.
Options:
1. Move the whole section — one undo step, what other editors do
2. Only the heading line — the text stays, structure usually breaks
Recommendation: 1 — it keeps the note's structure intact.
