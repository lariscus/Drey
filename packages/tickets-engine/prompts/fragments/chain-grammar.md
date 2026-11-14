<!-- drey-prompt-version: 4 -->
The chain grammar — a chain is the ticket's whole way: the ordered list of the personas it goes through, one entry per position. Each persona does what its own role says. The same persona may stand twice, but a position that shapes with the owner and then runs is ONE entry (":shape"), never the persona twice.
- "<persona>" — a persona id of the crew; "you" is the owner, who works that position by hand (an acceptance, a check).
- "<persona>:shape" — the owner first shapes the ticket with that persona in a chat; when the owner accepts the shaping, the persona's own run follows at the same position. One entry, one position.
- "<persona>(notify)" — a card lands in Needs you when that position is done.
- "<persona>(on-red <earlier persona>)" — when that position's machine gate goes red, the ticket goes back to the nearest earlier position of that persona, then straight back here. Options share one pair of parentheses: "tessa(notify, on-red paul)".
The positions up to the current one ("at" in the context) stay as they are; only later positions change.
Example: ["paul:shape", "ben", "ralf", "tessa(on-red paul)", "you"]
