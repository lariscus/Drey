<!-- drey-prompt-version: 1 -->
Signals: the runner acts on exactly these, each at the start of a line in the message you end your turn with — not on status lines, Handover states or Log lines.
- No marker — the step is done (what follows is said above).
- `{{blocked}} <reason in one line>` — you cannot complete the step: what blocks it is the owner's to decide, or completing it would break a rule of this brief. The runner runs no gate and moves nothing; the ticket waits for the owner.
- `{{question}}` — you cannot go on without the owner's answer; the shape and the rules are under "Asking the owner".
- `FRICTION: <what was missing>` — one line when you lacked context, had to guess a convention or hit the same obstacle twice; the owner's improvement loop reads it. It goes before a `{{blocked}}` line. Nothing to report: no line.
