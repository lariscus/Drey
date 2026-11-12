<!-- drey-prompt-version: 1 -->
The chain grammar — a chain is the ticket's whole delta against the standard flow, one canonical entry per item; an empty list means the standard flow:
- "insert <phase>[(<persona>[, notify] | notify)] after|before <anchor>" adds a gate; a phase the standard flow already has may be added once more, as a revisit.
- "skip <phase>" strikes a standard gate.
- "notify <phase>" lands a card in Needs you when the gate is done.
- "move <phase> after|before <anchor>" runs a standard gate somewhere else.
- "assign <phase> <persona>" pins who works a standard gate.
Phase ids and persona ids come from the context below. A gate marked locked, and one that has begun, stays as it is.
Example: ["insert security(ralf, notify) after review", "skip verify"]
