# Crew concept boards (2026-11-08) — what changed on the canvas and how to build it

**Source:** the owner's Grobkonzept "Drey crew" (Claude doc, 2026-11-08), reviewed and
adapted the same day against the code and against ADR-0092 (Drey Service), ADR-0093
(persona sessions), ADR-0095 (model table and capacity pool). **Canvas:** the boards are
published on the owner's canvas "Drey Tickets — Workflow redesign", version 83
(`1794147040-05e9`, 2026-11-08), as a new row "Crew concept, 2026-11-08" under board 10t
(7e and 10t revised in place); the repo copies in `boards/` are that version's.
**Status:** accepted by the owner on 2026-11-08 ("Boards sind ok") — the seven boards are
binding for the build like every other board in `boards/`. This note is the handoff for
the sessions that build the screens: which boards changed, what each shows, the measures,
and where the code lives. The boards themselves are in [boards/](boards/README.md) (the
`.dc.html` is the measure, the PNG the look); the fidelity rule of
[build-plan.md §4](build-plan.md) and the twelve steps of
[fidelity-checklist.md](fidelity-checklist.md) apply unchanged.

The concept's engine-side decisions that these boards presuppose (not UI, listed so the
build sessions know what the screens stand on):

- **Slots** are accounts: `Claude A`, `Claude B` (two Claude accounts, each the real Claude
  Code), `z.ai`, `Kimi`, at work `Copilot`. A slot has a profile (`Private` | `Work`; a
  repository is bound to one profile, never the other), a billing kind (subscription with
  a monthly price, or credits), quota windows (5 h rolling, 7 d weekly) each with the
  remaining share, reset time and a reliability (`measured` | `estimated` | `unknown`).
- **Surplus** `q = R / T` per slot (remaining share over remaining time share, minimum over
  the windows). Above `q ≈ 1.3` a bigger model of the same slot is attractive. **Never a
  downgrade**: a session requests a capability class and gets exactly it or waits (R10).
- **Tranches**: the Autopilot's On always releases one tranche (N runs, a budget share or a
  time span, whichever first); at its end the runner pauses and the Lead presents a
  checkpoint report; anomalies stop early.
- **Governor**: tasks take seats of a class (`light` = model runs, `heavy` = tests, builds,
  dev servers, browsers); 1–2 heavy at once, low process priority, a CPU/RAM reserve.
- **The Lead is Pia** (Mission Control) with a fixed command set; her decisions reach the
  owner as cards in the Mission Control conversation.
- **Drey Service is optional** (`service.enabled`, default off, owner ruling 2026-11-08).
- **The runner is refactored in TypeScript, not rewritten**; ACP is the target adapter
  protocol. (No screen; named here because the concept doc says so.)

## 1. Changed and new screens

| Board | File | Size | Change | Concept part | Roadmap / ADR | Code area (owner) |
|---|---|---|---|---|---|---|
| **7l** (new) | `DeskModels` | 1440×900 | Settings → Models: model table, capacity cap, slots with quota windows and q, routing (upgrade threshold, reserve, burn rate, "never a smaller class"), three ledgers | Kapazitäten und Routing; Fähigkeiten, Kosten und Routing; Dynamischer Preis | req-170, ADR-0095 (the page ADR-0095 asked a design pass for) | `plugins/tickets/renderer/settings/**` (Tickets → Models page), engine `service.json` model table |
| **7e** (revised) | `DeskBoard` | 1440×900 | Capacity band gains a Slots row (per slot: busy dots, quota bar, q, reset) and a Tranche-and-queue row; header value `2 of 5 sessions · 1 queued`; everything else unchanged | Parallele Sessions; Begrenzungen und Lastschutz | req-170, ADR-0077/0095 | `plugins/tickets/renderer/board/**` (Capacity band) |
| **10t** (revised) | `Autopilot` | 1440×900 | Popover On shows the tranche (chips, progress bar, "Pauses with a checkpoint report after the tranche"); Paused at a checkpoint shows `Checkpoint report waiting` and `Release next tranche` / `Adjust…`; phone sheet the same; status-bar tooltip names the tranche | Begrenzungen und Lastschutz → Checkpoints | ADR-0077 later change (tranche as the Autopilot's release unit) | `plugins/tickets/renderer/autopilot/**`, `status-slot.ts`, `libs/mission-ui` (iPad chip, phone sheet) |
| **8a** (new) | `ServiceWindow` | 1100×720 | Drey Service window, Components tab: component list, Slots block, Governor block, filtered log (routing decisions, refusals, governor seats, tranche), footer, the tray menu as an inset | Parallele Sessions; Runner-Architektur; Schnittstelle | req-165, ADR-0092 | Drey Service window process (new, Electron; `packages/tickets-engine/src/service/**` + a small window app) |
| **8b** (new) | `ServiceSessions` | 1100×720 | Sessions tab: every harness session raw — list, facts (harness, session ref, tokens, MCP, slot, seats), Stream / Instruction / Tool calls / Process / Raw JSON, send, interrupt turn, resume after stop | Parallele Sessions → Überwachen, Eingreifen | req-166, ADR-0092, ADR-0075 steer ladder | same as 8a |
| **8c** (new) | `DeskServiceSettings` | 1440×900 | Settings → Background service: status and controls, background service on/off, start with Windows, keep running, taskbar icon, components, **Load** (heavy seats, reserve, low priority, quiet hours), logs | Schnittstelle; Begrenzungen → Lokale Last | req-165, ADR-0092 | `src/app/settings/**` (core category) |
| **10u** (new) | `MCCards` | 1480×1160 | The Lead's decision cards at 1:1, desktop and phone: checkpoint report, merge conflict (runner stopped), budget stop (ticket allowance), quota stop (slot empty), queued explanation, early stop (anomaly) | Akteure (Lead); Kreislauf; Worktrees → Konflikte; Begrenzungen | ADR-0093 (Pia executes), ADR-0095 ledgers; new roadmap rows needed for tranche, governor, slots (see §4) | `plugins/tickets/renderer/conversation/**` (desktop Assistant cards), `libs/mission-ui/src/**` (phone) |

**Build status (2026-11-09):** 8c built (milestone 216), 7e built (milestones 218 and 221 — the tranche part of row 3), 7l built (milestone 220), **10t built** (milestone 221, req-179: desktop On and the checkpoint state, iPad On and Paused at a checkpoint, the phone sheet) and **10u parts 1, 6 and 7 built** (milestone 221: the checkpoint and early-stop cards in the desktop Assistant's Mission Control thread, the phone/iPad chat card); 10u parts 2–5, 8, 9 wait for the rows that raise those cards; 8a / 8b with req-165 / 166 (milestone 222). Milestone 223 (req-181): 7l's **Routing group is wired** (the three fields read and store the engine's `routing`), and the **burn-rate card** — no part of its own — takes 10u's chrome laid out like part 4 (desktop) and part 9 (phone). Milestone numbers provisional until the integrator merges.

Not changed, by decision: 7f Crew tab and 7k Persona page (req-171's mockup
`crew-internals/persona-page-mockup.html` stands; the concept adds only the per-persona
sub-agent policy `off | read-only`, a one-row addition to "Allowed to" when 7k v2 is drawn);
the owner's own prototype "Drey crew: Assistant Konzepterstellung" (concept editor with
statement ids, delta bar) is the owner's artifact and not redrawn here; Repositories gain a
`Profile: Private | Work` field (a plain dropdown row in Settings → Tickets → Repositories,
no board).

## 2. Measure sheets

One table per board: the elements the board shows with their measures, colours (as the
Anthrazit tokens of `src/styles.css` map them: `#18191b` → `--bg-main`, `#222326` →
`--bg-sidebar`, `#2c2d31` → sunken/hover, `#3b3d42` → `--border`, `#747980` → control
border, `#f4f5f6` → `--text-primary`, `#b3b7bc` → `--text-3`, `#8ecbef` → `--accent`,
`#93c47f` / `#e0bb6e` / `#ee8f89` → the `--status-*` hues, `#f2cfae` peach, `#bfe3cd` mint,
`#f2d3e2` pink), type and strings. The build session copies these into its own measure sheet
(checklist step 3) and adds the "what the build does differently" column.

### 7e `DeskBoard` — the Capacity band (only the band changed)

The band grew from 85 px to 145 px (28 px header + 116 px content: 56 persona row + 32
slots row + 28 tranche row); the board area above shrinks by 60 px. Everything outside the
`<section aria-label="Capacity">` is byte-identical to the 2026-11-06 board.

| Element | Size / position | Colours | Type | Strings |
|---|---|---|---|---|
| Header status value | after the title, as before | `#b3b7bc` | 13px | `2 of 5 sessions · 1 queued` |
| Persona row | 56 px, unchanged | — | — | unchanged |
| Slots row | 32 px, padding 0 8px, gap 6px, chips `flex-shrink: 0` | — | 13px | — |
| Slot chip | 26 px high, padding 0 8px, inner gap 6px, radius 4px | border `#3b3d42` | 13px | `title="resets Mon 09:00"` (Kimi: `quota unknown`) |
| Slot name | first in the chip | `#f4f5f6` | 13px 600 | `Claude A`, `Claude B`, `z.ai`, `Kimi` |
| Busy / free dots | 7 px, gap 3px (the persona dots' style) | busy filled `#f4f5f6`, free outlined `#747980` | — | — |
| Quota bar | 48×4 px, radius 2px | track `#2c2d31`; fill `#8ecbef` = remaining weekly share; `#e0bb6e` when estimated; no bar when unknown | — | `62 %`, `31 %`, `70 %`; Kimi `unknown` |
| q value | after the share | `#b3b7bc` | 13px | `q 1.4`, `q 0.8`, `q 1.2`; none for Kimi |
| Upgrade mark | 12 px up-chevron SVG after q, only when q > 1.3 | `#8ecbef` | — | — |
| Reset | 12 px refresh-circle SVG + time | `#b3b7bc` | 13px | `Mon 09:00` (not on Kimi) |
| Tranche row | 28 px, padding 0 8px 6px, gap 12px | `#b3b7bc` | 13px, single line, ellipsis | `Tranche 4 of 10 runs · $4.10 of $15 · checkpoint in 6 runs or 2 h 10 min` |
| Tranche progress | 120×4 px, radius 2px | track `#2c2d31`, fill `#8ecbef` 40 % | — | — |
| Queue text | right-aligned, 14 px clock SVG before it | `#b3b7bc` | 13px | `T-0123 queued · waits for a B slot · 2nd` |

Chip widths at the sample data: Claude A ≈ 316, Claude B ≈ 288, z.ai ≈ 277, Kimi ≈ 127 px;
the row ends ≈ 77 px before the column edge. With more slots the row wraps (never scrolls).

### 10t `Autopilot` — tranche and checkpoint

Layout of the board changed to fit the taller popovers: left column 720 px (desktop frame
720×350, iPad frame 720×423), right column 600 px (phone frame 390×560, the explanatory
card under it). The states shown: desktop **On**, iPad **Paused at a checkpoint** (its header
chip now reads `Autopilot · Paused` with the peach dot), phone **Paused**.

| Element | Size / position | Colours | Type | Strings |
|---|---|---|---|---|
| Desktop popover chips | 26 px chips, wrap to two rows, gap 6px | border `#3b3d42`, text `#b3b7bc` | 13px | `Tranche 4 of 10 runs`, `$4.10 of $15 today`, `2 h 10 min left` |
| Desktop progress bar | 100 % wide × 4 px, radius 2px, under the chips | track `#2c2d31`, fill `#8ecbef` 40 % | — | — |
| Desktop note line | under the bar | `#b3b7bc` | 13px | `Pauses with a checkpoint report after the tranche.` |
| Status-bar item | unchanged | — | — | text `Autopilot · On`; tooltip `Autopilot: On · tranche 4 of 10 (Mod+Alt+P)` |
| iPad popover sentence | two lines | `#b3b7bc` | 15px/20px | `Paused at a checkpoint. Running steps finished, nothing new starts.` |
| iPad chips | 26 px | `Checkpoint report waiting` text `#f2cfae`; others `#b3b7bc`; border `#3b3d42` | 13px | `Checkpoint report waiting`, `Resume at 18:00`, `$4.10 of $15 today` |
| iPad button row | 44 px high, gap 8px, under the chips | primary filled `#8ecbef` / `#101113` 600; secondary outlined `1px solid #747980` | 15px | `Release next tranche`, `Adjust…` |
| Phone sheet header | right of the title | `#b3b7bc` | 13px | `Checkpoint · resume at 18:00` |
| Phone release button | 48 px, full width, between the options and the stop button | filled `#8ecbef` / `#101113` | 16px 600 | `Release next tranche` |
| i18n keys named on the card | — | — | — | `autopilot.tranche {done} {total}`, `autopilot.checkpoint_waiting`, `autopilot.release_next` |

### 8c `DeskServiceSettings` — Settings → Background service

The chrome (title bar 40, tab bar 36 with the `Settings` tab, search field 36, scope tabs
34, 240 px nav, status bar 28) is 7g's, copied verbatim. New core category **Background
service** in the nav between Assistant and Editor (current, `#2c2d31`). Content column max
760 px, padding 18 32; h1 26/34 700, h2 18/26 600 with margin 22 0 4. Service and
Components are above the fold; Load and Logs are clipped at 900 px as 7g clips too.

| Element | Size / position | Colours | Type | Strings |
|---|---|---|---|---|
| Status item | 7g item layout, vertical padding 10px; value then three 30 px outlined buttons, gap 8px | buttons `1px solid #747980` | value 14px | `Running since 08:12 · 4 components · 2 runs live` · `Open Drey Service…` · `Restart` · `Stop` |
| Checkbox items | 18 px box, accent `#8ecbef`, vertical padding 10px | description `#b3b7bc` | 14/21 | `Background service` — `Runs on its own and keeps working after Drey quits. Off: everything ends with Drey.` (checked); `Start with Windows` — `Starts at sign-in, before Drey.` (checked) |
| Compact rows (a deviation from 7g to keep Components above the fold) | name + description left; state or field in a 230 px middle column; buttons in a 142 px right column; padding 8px, gap 12px | field `#2c2d31`, border `#747980`, 32 px | 14px | `Keep running after Drey quits` — `15` `minutes` — `Live runs and a running Autopilot always keep it alive.`; `Taskbar icon` — `Shown` — `Hide` |
| Components (compact rows) | as above | — | 14px | `Tickets engine` — `running` — `Always on while the service runs.`; `Crew runner` — `running · 2 live` — `Restart` `Stop`; `MCP server` — `running · 127.0.0.1:4319 · 3 clients` — `Restart` `Stop`; `Remote gateway` — `off` — `Start` — `Phones and the iPad. Pairing under Tickets → Devices.` |
| Load (below the fold) | 7g field items | — | 14px | `Heavy seats` `2` `at once` — `Tests, builds, dev servers and browsers. Model runs are light.`; `Reserve` `25` `% of CPU and memory kept free`; `Low priority for heavy tasks` (checkbox, checked) — `Heavy tasks run behind everything else.`; `Quiet hours` `22:00 – 07:00` (200 px field) — `No new heavy task starts in this span.` |
| Logs (below the fold) | 7g action items | path mono 12px | 14px | `Log level` `Normal` `Change…`; `Log folder` `C:\Users\puls\AppData\Roaming\drey\service\logs` `Open folder` — `One file per component, rotated daily, kept 14 days.` |

Build note: the compact row is the one new item shape on this page; if the Settings
framework keeps strict 7g items, Components fall below the fold instead — the owner decides
on the board.

### 8a `ServiceWindow` — Drey Service window, Components

1100×720. Window title bar 36 px `#222326`: 22 px accent `D` square, `Drey Service` 13px,
three 40×36 window controls. Tab strip 32 px with 26 px pills (`Components` selected
`#2c2d31` 600 · `Sessions` · `Logs`), 13px. Status line 28 px with an 8 px green dot.
Body padding 4 16 16, gap 16: left column 560 px, right column the rest (≈ 492 px). Footer
36 px `#222326`.

| Element | Size / position | Colours | Type | Strings |
|---|---|---|---|---|
| Status line | 28 px | `#b3b7bc`, dot `#93c47f` | 13px | `Running since 08:12 · pid 18240 · 4 components · 2 runs live · $4.10 of $15 today` |
| Component rows | 44 px, 8 px state dot, 24 px icon buttons (restart ↻, stop ■) on the hovered row | hover row `#2c2d31`; dots `#93c47f` running, `#747980` off, `#ee8f89` failed | name 13px 600, detail 13px `#b3b7bc` | `Tickets engine` — `127.0.0.1:52114 · vault drey-tickets`; `Crew runner` — `2 runs live · 1:1 with Ben idle 4 min`; `MCP server` — `127.0.0.1:4319 · 3 clients (2 runs, Claude Desktop)`; `Remote gateway` — `off · phones and iPad`; `Local model (LM Studio)` — `not reachable · last seen 07:40` |
| Slots block | header 28 px with 1px `#3b3d42` bottom border; rows 28 px: name 96 px, busy dots 8 px, bar 48×4, text, reliability chip 22 px radius 4 right-aligned | bar fill `#8ecbef`, `#e0bb6e` estimated, empty track when unknown; chip text mint / yellow / `#b3b7bc` | 13px | `Claude A` 1/2 `62 % · q 1.4 · resets Mon 09:00` `measured`; `Claude B` 0/1 `31 % · q 0.8 · resets Tue 14:00` `measured`; `z.ai` 1/3 `70 % · q 1.2 · resets Wed 00:00` `estimated`; `Kimi` 0/2 `no quota readout` `unknown` |
| Governor block | header 28 px; rows 28 px; label column 96 px | label `#b3b7bc`, value `#f4f5f6` | 13px | `Heavy seats` `1 of 2 busy · tests for T-0126`; `Light seats` `2 of 6 busy`; `Reserve` `25 % CPU and RAM kept free · load 41 %`; `Waiting` `1 heavy task (build T-0121) · starts when a seat frees`; `Dev servers` `1 · port 4302 (T-0126)` |
| Log panel | 1px `#3b3d42` border, radius 8; header 36 px `#222326` with title `Log`, segmented `All · Warnings · Errors` (26 px, `All` selected), `Follow` switch 32×18; list `#18191b` | warning lines `#e0bb6e`, refusal `#ee8f89` | mono 12/18, time column 56 px, single line with ellipsis | the 14 lines from the brief: runner up, chain config, run start, `route T-0126 → z.ai/glm-5.3: class B, q 1.2, est $0.22 · filtered: kimi (no image input)`, mcp token, turn usage, `no output for 9 min`, session open, session idle, run start, `route T-0121 → claude-a/sonnet: class B, q 1.4, est $0.40`, `mcp: vault_write refused — …`, `governor: heavy seat granted to T-0126 tests · 1 of 2`, `tranche 4 of 10 runs · checkpoint in 6 runs` |
| Footer | 36 px | note `#b3b7bc`; `Quit service` text `#ee8f89` | 13px; buttons 28 px outlined | `Service runs in the background. Closing this window keeps it running.` · `Open Drey` · `Quit service` |
| Tray menu inset | absolute right 16, bottom 56, 220 px; caption `TRAY MENU` 12px uppercase above | card `#222326`, border `#3b3d42`, radius 8, padding 4 | rows 32 px, 13px | `Drey Service · running` (header, green dot) · `Open Drey Service…` · `Open Drey` · `Autopilot: Paused at checkpoint ›` · `Stop all running steps…` (red) · divider · `Start with Windows ✓` · `Quit service` |

### 8b `ServiceSessions` — Drey Service window, Sessions

Same title bar and tab strip (`Sessions` selected). Left list 320 px with a 1px right
divider; right pane the rest.

| Element | Size / position | Colours | Type | Strings |
|---|---|---|---|---|
| Summary line | 28 px | `#b3b7bc` | 13px | `3 sessions · 2 runs · 1 held` |
| Session rows | 56 px (second line may wrap), 8 px state dot, 24 px stop ■ / eject ⏏ icon button right | selected `#2c2d31`; dots `#93c47f` running, `#e0bb6e` held | 13px, name 600 | `T-0126 · test · Tessa` — `opencode · qwen3-coder · turn 6 · 9 min quiet`; `T-0121 · build · Ben` (selected) — `claude-code · sonnet · turn 3 · writing`; `1:1 · Ben` — `claude-code · sonnet · held · releases in 11 min` |
| Group row | 28 px | `Show` in `#8ecbef` | 13px | `Ended today · 7 · Show` |
| Header block | padding 16 16 12; buttons 30 px outlined right | id line `#b3b7bc` | title 15px 600; id mono 12px | `T-0121 · build · Ben`; `R-20261107T0833-c02e · pid 19877 · origin chain · fresh`; `Open worktree` · `Copy attach command` · `Stop` |
| Fact grid | 2 columns, label column 104 px, gap 6/24 | labels `#b3b7bc` | 13px | `Harness · model` `claude-code 2.1 · sonnet · permission auto`; `Session ref` `e4b9…71c0 · resumable`; `Tokens` `112k in (98k cached) · 4.1k out · $0.61`; `MCP` `vault read · tickets · 14 calls, 1 refused`; `Slot` `Claude A · class B · q 1.4`; `Seats` `light` |
| Tab strip | 36 px `#222326`, 1px borders; `Follow` switch right | selected pill `#2c2d31` | 13px | `Stream` · `Instruction` · `Tool calls` · `Process` · `Raw JSON` |
| Stream | time 56 px, kind 64 px, text | kind and time `#b3b7bc`; refusal line `#ee8f89` | mono 12/18, wrapping | the ten lines from the brief (`system init …`, `user [instruction, 9.8k tokens — open under Instruction]`, `assistant …`, `tool Read … → 212 lines`, `tool mcp__drey__vault_search … → 3 hits`, `tool mcp__drey__vault_write → Error: ben may not write vault "notes" (allowed: read)`, `tool Edit … (+18 −0)`, `tool Bash npm run test:plugin -- tickets -t "order" → exit 1 (1 failed)`, `assistant …`, `usage turn 3 · input 41k (38k cached) · output 1.4k`) |
| Composer | padding 10, `#222326`; input 32 px `#18191b`, border `#747980`, radius 8, no placeholder | `Send` filled `#8ecbef` / `#101113` | 13px | `Send` · `Interrupt turn` · `Resume after stop ▾` |
| Footer line | padding 8, `#222326` | `#b3b7bc` | 13px, wraps | `Drey's Thread shows this session cleaned up; here it is the harness as it speaks. Everything you send is logged to the ticket.` · `Open in Drey` |

### 10u `MCCards` — the Lead's cards, desktop and phone (parts at 1:1)

1480×1160, page `#18191b`, captions 12/16 uppercase `#b3b7bc` letter-spacing 0.06em,
28 px caption-to-card gap, ≥ 24 px between parts. Desktop cards 348 px wide (the Assistant
panel's 380 px minus 2×16 padding), phone cards 358 px.

| Element | Size / position | Colours | Type | Strings |
|---|---|---|---|---|
| Card chrome, desktop | 348 wide, padding 14, gap 10, radius 8, 1px border | `#222326`, border `#3b3d42` | title 15/20 600, body 14/20, quiet line 13/18 `#b3b7bc`, meta 13/18 `#b3b7bc` at the card's bottom | meta `Mission Control · 14:02` (14:03, 14:04) |
| Card chrome, phone | 358 wide, padding 14, radius 16 (as 10m) | same | title 17/24 600, body 17/24, secondary 15/22 | — |
| Status dot | 8 px circle before the title | peach `#f2cfae` (checkpoint, quota), conflict `#f08080`, red `#ee8f89` (budget stop, early stop) | — | — |
| Buttons, desktop | 32 px, radius 4, padding 0 8, gap 6 (8 with two buttons) | primary `#8ecbef` / `#101113` 600; outlined `1px solid #747980` `#f4f5f6` | 13px | see parts |
| Buttons, phone | 48 px, radius 8; stacked full width or two side by side | same | 16px | — |
| Metric grid | 2×2, gap 10/12 | label `#b3b7bc` | label 13 (phone 15); lead value 20/26 600, rest 13 (phone 15) `#b3b7bc` | `Gate rate` `7 of 8` `green`; `Change size` `+212 −40` `median lines`; `Cost per run` `$0.41` `median · $1.20 max`; `Repeated` `T-0119` `ran twice` |
| File rows (conflict) | 28 px (phone 32), radius 4, `#18191b`; 18 px `C` badge radius 4 | badge `#f08080` / `#101113` | name mono 12px | `order.ts`, `order.spec.ts`, `board.css` |
| Red-ticket rows (early stop) | 28 px, `#18191b`, 6 px dot | `#ee8f89` | 13px | `T-0119 · build · Ben · red twice`, `T-0124 · test · Tessa`, `T-0125 · review · Ralf` |
| Chips | 26 px (phone 28), padding 0 10, 1px `#3b3d42`, radius 4 | `#b3b7bc` | 13 (phone 15) | `resets 14:00`, `q 0.6` |
| Queued answer | no frame, 348 wide, meta line above the text | — | 15/23 | `T-0123 waits for a B slot, second in line. Tessa's test on T-0126 finishes in about 5 minutes; Claude A then has a free slot.` |

Parts and their positions: 1 Checkpoint (x 40, caption y 32): `Checkpoint · tranche 1 of
3 done`, metrics, `Autopilot paused · 10 runs · $4.10 · 2 h 10 min`, `Release next tranche` /
`Adjust…` · 2 Merge conflict (x 40, y 388): `Conflict on T-0121 · t/T-0121 into main`, `3
files conflict: order.ts, order.spec.ts, board.css. Ben's run stopped; nothing was resolved by
a model.`, file rows, `Resolve in Drey` / `Let Ben rebase` / `Send back…` · 3 Budget stop
(x 40, y 728): `T-0126 stopped · allowance reached`, `$2.61 of $2.50 spent across 3 runs.
Tessa's test run was stopped before its gate.`, `Raise to $5.00` / `Keep stopped` · 4 Quota
stop (x 420, y 32): `Claude A · 5 h window empty`, `Resets at 14:00. T-0121 waits; z.ai and
Kimi do not meet class B for this step.`, chips, `Wait` / `Allow class C once` · 5 Queued
(x 420, y 292) · 6 Early stop (x 420, y 448): `Stopped early · gate rate fell`, `3 of the
last 6 gates were red; the tranche had 6 runs left. Nothing new starts until you release
it.`, rows, `Open report` / `Release anyway` · 7 Phone checkpoint (x 1040, y 32) · 8 Phone
merge conflict (x 1040, y 472; `Resolve in Drey` full width, then `Let Ben rebase` and
`Send back…` side by side) · 9 Phone quota stop (x 420, y 776; `Wait` and `Allow class C
once` side by side).

### 7l `DeskModels` — Settings → Models

7g's chrome copied verbatim (title bar, tab bar with the `Settings` tab, search field, scope
tabs, 240 px nav, status bar). Nav: Tickets open with `Crew · Flow · Autopilot · Models ·
Devices`, Models current (`#2c2d31`, 600). Content column max 760 px, padding 18 32; h1
`Models` 26/34 700; h2 18/26 600 (`Model table · Capacity · Slots · Routing · Ledgers`).
Shown unscrolled: the table, the Add-model row, Capacity and the Claude A card are visible;
the other slot cards, Routing and Ledgers are below the fold.

| Element | Size / position | Colours | Type | Strings |
|---|---|---|---|---|
| Model table | 760 px wide; header row + 6 body rows, 32 px each; `Cost factor` and `Sessions` right-aligned | header `#b3b7bc`; rows `#f4f5f6`; dividers `1px #3b3d42` | 13px; model id mono 12px | columns `Model · Provider · Category · Class · Cost factor · Sessions`; rows `claude-opus-4-1 · Claude A · frontier · A · 5 · 1`, `claude-sonnet-4-5 · Claude A · everyday · B · 1 · 2`, `claude-sonnet-4-5 · Claude B · everyday · B · 1 · 2`, `glm-5.3 · z.ai · everyday · B · 0.4 · 3`, `kimi-k2.5 · Kimi · bulk · C · 0.3 · 2`, `gpt-5.4 · Copilot [Work] · everyday · B · 1 · 2` |
| Work row | text `#b3b7bc`; `Work` chip 22 px, border `#3b3d42`, 12px, negative margin keeps the row 32 px | — | — | `Work` |
| Add-model row | outlined button 30 px, radius 4; description beside it | `#747980` border; description `#b3b7bc` | 14/21 | `Add model…` · `Sessions = concurrent sessions a provider serves. Only active sessions count.` |
| Capacity | two columns, 32 px gap: `Global cap` field 100 px + unit; `Per provider` read-only 2×3 list, name column 64 px; status line under the field | status `#b3b7bc` | 14px field, 13px list | `Global cap` `6` `cost factor, active sessions`; `Per provider` `Claude A 5 · Claude B 2 · z.ai 1.2 · Kimi 0.6 · Copilot 2`; `Now: 2.4 of 6 · Claude A 2 of 5 · z.ai 0.4 of 1.2` |
| Slot card | `#222326`, `1px #3b3d42`, radius 8, padding 12, gap 8; line 1 name 14px 600 + profile chip 22 px + billing right-aligned; one 22 px row per window; the q text right-aligned on the first window row | billing `#b3b7bc` | 13px | `Claude A` `Private` `subscription · €90 / month`; `5 h` bar `78 % left · resets 14:20` `measured`; `7 d` bar `62 % left · resets Mon 09:00` `measured`; `q 1.4 · upgrade allowed` |
| Window mini-bar | 120×6 px, radius 3 | track `#2c2d31`, fill `#8ecbef`; the part below the reserve share `#f2cfae` | — | — |
| Reliability chip | 20 px, transparent, `1px #3b3d42`, radius 4 | text `#bfe3cd` measured / `#e0bb6e` estimated / `#b3b7bc` unknown | 12px | `measured`, `estimated`, `unknown` |
| Other slots (below the fold) | same card | — | — | `Claude B` Private `€90 / month`, `7 d 31 % left · resets Mon 09:00` measured, `q 0.8 · class B only`; `z.ai` Private `€30 / month`, `5 h 55 % left · resets 15:05` and `7 d 70 % left · resets Sun 00:00` estimated, `q 1.2 · class B only`; `Kimi` Private `€19 / month`, no bar, `counted from own usage` `unknown`, `q 1.0 · class C only`; `Copilot` Work `credits · €0.04 / credit`, `month` bar 41 %, `412 of 1,000 left · resets 1 Dec` estimated, `q 0.9 · class B only`; then `Add slot…` |
| Routing (below the fold) | 7g field items | — | 14px | `Upgrade above q` `1.3`; `Reserve per window` `10` `%`; `Burn rate` `20` `% of the weekly quota per day, all slots`; plain text `A session gets exactly its class or waits. Never a smaller class.` |
| Ledgers (below the fold) | 7g field items, 100 px fields | — | 14px | `Ticket allowance` `$2.50` (`default; a ticket may set its own`); `Persona per day` `$5.00`; `Provider per day` `$15.00` |

## 3. How a build session uses this

1. Read the board HTML and PNG (checklist §0), this note's row for the board, and the
   concept facts above. Strings are copied verbatim into the i18n catalog
   (`shared/i18n/catalog/en.json`, ADR-0091); sample data is data.
2. Build at the board's size, screenshot at 1:1, compare in `boards/compare.html`, write the
   deviation list (checklist §2). Permitted justifications as in the checklist, plus
   "feature not yet built — <roadmap id>" for an element whose engine side is missing
   (e.g. measured quota windows before Spike 4 lands show `unknown`).
3. A screen that needs an engine value the engine does not have yet (q, windows, tranche
   counters, governor seats) draws the board's layout with the `unknown` / empty state the
   board shows for Kimi, and names the engine item in the deviation list.

## 4. Open items this handoff leaves

- Roadmap rows for the concept's engine pieces that have no id yet: slots per account with
  quota windows (Spike 4 first: can the quota be read per account?), surplus routing,
  tranches and the checkpoint report, the resource governor, the burn rate, review in a
  read-only checkout, `_worktrees/<id>.ticket.md` → `_workcopy/`. They belong in
  `specs/roadmap.md` under the Crew internals block, after req-173, once the owner accepts
  these boards.
- Settings → Models (7l) shows measured windows for Claude and z.ai. Spike 4 (2026-11-08)
  settled what the real page can show: all three slots `measured` — z.ai (quota endpoint,
  two windows), Kimi (usage endpoint with the CLI's self-refreshed token: 5 h and two
  monthly ratios), Claude Code (headless stream-json emits a `rate_limit_event` with the
  five-hour and seven-day windows after each turn; the `.claude.json` cache per
  `CLAUDE_CONFIG_DIR` is the fallback between runs). The board's `measured` chips on the
  Claude cards are right as drawn; `estimated` stays for Copilot and for a slot without a
  recent run. An expired login is a slot state `needs login` (a card of 10u's kind), never
  a retry.
- 7k v2 (req-171) as a canvas board, with the sub-agent policy row.
