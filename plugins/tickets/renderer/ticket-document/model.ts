/**
 * The ticket as a document (E13-6, roadmap "Mission Control on the
 * desktop, inside Drey"): the pure half. What the header strip, the proof
 * widget, the cost table and the action bar draw is computed here from the
 * ticket's text and the board — no DOM, no CodeMirror, no IPC.
 *
 * Nothing is parsed twice: the sections come from the engine's own readers
 * (`parseVerificationSection`, `parseVerlaufEntries`), the chain from its
 * `chainSteps`, the estimate and its basis from its `RunEstimate`. This
 * file only turns them into the words the desktop shows (the same words
 * the phone's ticket screen uses: `$1.84`, `48k`, `9 min`).
 */
import { maskFenceLines } from '../../../../shared/markdown/fences';
import { chainCursor, chainLifeOf, chainSteps } from '../../../../packages/tickets-engine/src/core/pipeline/chain-list';
import type { ChainEntry } from '../../../../packages/tickets-engine/src/contracts/chain';
import { parseVerificationSection } from '../../../../packages/tickets-engine/src/core/chapters/verification';
import { parseVerlaufEntries, type VerlaufEntry } from '../../../../packages/tickets-engine/src/core/chapters/history-chapter';
import { costTableOf, type CostPhase, type CostTableView } from '../../../../shared/cost-table';
import { costInTotalText, costSoFarText } from '../../../../shared/cost-text';
import type { I18n } from '../../../../shared/i18n/types';
import type { VerificationReport } from '../../../../packages/tickets-engine/src/contracts/verify';
import type { BoardSnapshot, PipelinePhase, TicketCard } from '../../shared/tickets';
import { needKindLabel, type WorkRow } from '../work/work-groups';

export const titleCase = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1);

// --- text ranges ------------------------------------------------------------

export interface TextRange {
  readonly from: number;
  readonly to: number;
}

/**
 * The body of the `## <name>` section: from the start of its first line
 * after the heading to the end of its last non-blank line. The section ends
 * at the next heading of level 1–2; headings inside a code fence don't
 * count. Null when the section is absent or empty. Offsets index `text`.
 */
export function sectionBodyRange(text: string, name: string): TextRange | null {
  let offset = 0;
  let inSection = false;
  let from: number | null = null;
  let to: number | null = null;
  const heading = new RegExp(`^##\\s+${name}\\s*$`);
  const rawLines = text.split('\n');
  const scan = maskFenceLines(rawLines);
  for (const [i, rawLine] of rawLines.entries()) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    const probe = scan[i]!.endsWith('\r') ? scan[i]!.slice(0, -1) : scan[i]!;
    const lineEnd = offset + line.length;
    if (/^#{1,2}\s/.test(probe)) {
      if (inSection) {
        break;
      }
      inSection = heading.test(probe);
    } else if (inSection && line.trim() !== '') {
      from ??= offset;
      to = lineEnd;
    }
    offset += rawLine.length + 1;
  }
  return from !== null && to !== null ? { from, to } : null;
}

/**
 * The whole `## <name>` section, heading included, to the end of its last
 * non-blank line: what a widget standing in for the section replaces.
 */
export function sectionRange(text: string, name: string): TextRange | null {
  const body = sectionBodyRange(text, name);
  if (body === null) {
    return null;
  }
  const before = text.slice(0, body.from);
  const head = [...before.matchAll(new RegExp(`^##[ \\t]+${name}[ \\t]*\\r?$`, 'gm'))].pop();
  return head === undefined ? null : { from: head.index, to: body.to };
}

// --- the proof widget -------------------------------------------------------

export interface ProofCheck {
  readonly label: string;
  readonly passed: boolean;
  /** The judge's or runner's remark; null = none. */
  readonly note: string | null;
  /** The video chapter's offset for this criterion (`0:12`); null = none. */
  readonly at: string | null;
}

export interface ProofShot {
  /** The file name in `tickets/attachments/`. */
  readonly file: string;
  readonly caption: string;
}

export interface ProofVideo {
  /** The file name in `tickets/videos/`; null when the recording was not kept. */
  readonly file: string | null;
  /** The honest line for a recording dropped over the per-video cap (E11-1c); null = kept. */
  readonly notKept: string | null;
  readonly chapters: readonly { readonly atMs: number; readonly at: string; readonly label: string }[];
}

export interface ProofView {
  /** `4/4 green.` — the one line over the checks. */
  readonly summary: string;
  readonly allPassed: boolean;
  /** `Tested on 2026-11-04 by Tessa, Electron 34.2.0 on win32.` */
  readonly stamp: string;
  /** Who ran the checks, as the words `Tested by …` use. */
  readonly tester: string;
  readonly checks: readonly ProofCheck[];
  readonly shots: readonly ProofShot[];
  readonly video: ProofVideo | null;
  readonly findings: readonly string[];
}

/** `m:ss` from milliseconds — the same chapter words the section writes. */
export function offsetWords(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** The report as the widget draws it. Null criteria and no video still give a view (the stamp alone). */
export function proofViewOf(i18n: I18n, report: VerificationReport): ProofView {
  const chapters = (report.videoChapters ?? []).map((chapter) => ({
    atMs: chapter.atMs,
    at: offsetWords(chapter.atMs),
    label: chapter.label,
  }));
  const checks: ProofCheck[] = report.criteria.map((criterion) => ({
    label: criterion.command,
    passed: criterion.passed,
    note: criterion.note,
    at: chapters.find((chapter) => chapter.label === criterion.command)?.at ?? null,
  }));
  const shots: ProofShot[] = report.criteria
    .filter((criterion) => criterion.screenshot !== null)
    .map((criterion, index) => ({
      file: criterion.screenshot!,
      caption: i18n.t('ticket.proof.shot', { n: index + 1, label: criterion.command }),
    }));
  const passed = checks.filter((check) => check.passed).length;
  const total = checks.length;
  const allPassed = total > 0 && passed === total;
  const summary =
    total === 0
      ? i18n.t('ticket.proof.none')
      : allPassed
        ? i18n.t('ticket.proof.green', { passed, total })
        : i18n.t('ticket.proof.failing', { passed, total, failing: total - passed });
  const day = /^\d{4}-\d{2}-\d{2}/.exec(report.testedAt)?.[0] ?? report.testedAt;
  const tester = /^verify@/.test(report.tester) ? i18n.t('ticket.proof.verify_run') : report.tester;
  const stamp =
    report.testedAt === ''
      ? ''
      : report.environment === ''
        ? i18n.t('ticket.proof.stamp_short', { day, who: tester })
        : i18n.t('ticket.proof.stamp', { day, who: tester, environment: report.environment });
  const video: ProofVideo | null =
    report.video !== undefined && report.video !== null
      ? { file: report.video, notKept: null, chapters }
      : report.videoNotKept !== undefined
        ? { file: null, notKept: report.videoNotKept, chapters: [] }
        : null;
  return { summary, allPassed, stamp, tester, checks, shots, video, findings: report.findings };
}

/** The ticket text's `## Verification` as a view; null when the ticket has none. */
export function proofOfText(i18n: I18n, text: string): ProofView | null {
  const report = parseVerificationSection(text);
  return report === null ? null : proofViewOf(i18n, report);
}

/** `drey-asset://<vault>/asset/<path>` — the URL the editor's own images use. */
export function assetUrl(vaultId: string | null, relative: string): string {
  const encoded = relative.split('/').map(encodeURIComponent).join('/');
  return vaultId !== null && vaultId !== '' ? `drey-asset://${vaultId}/asset/${encoded}` : `drey-asset://asset/${encoded}`;
}

// --- the cost table ---------------------------------------------------------

export type { CostPhase, CostTableView } from '../../../../shared/cost-table';

/**
 * The ticket text's `## Verlauf` as the cost-by-phase table (req-98); null
 * when it holds no run. `chain` adds the quiet `no run yet` rows of the
 * phases the ticket has still to pass.
 */
export function costTableOfText(
  i18n: I18n,
  text: string,
  phaseTitle: (id: string) => string,
  chain: readonly CostPhase[] = [],
): CostTableView | null {
  const entries = parseVerlaufEntries(text);
  return entries.length === 0 ? null : costTableOf(i18n, entries, phaseTitle, chain);
}

// --- the header strip -------------------------------------------------------

export interface PersonaName {
  readonly id: string;
  readonly title: string;
}

export interface ChainItem {
  /** The pipeline column this persona's step is estimated under (the persona's own column), else the persona id. */
  readonly phase: string;
  /** 1-based position in the chain. */
  readonly position: number;
  /** The persona's name (its id, title-cased, when no record names it). */
  readonly title: string;
  readonly state: 'past' | 'current' | 'future';
  /** Who does the step: a persona's name, `you` for the owner. */
  readonly who: string;
  /** The persona's id (for the estimate's key); null at the owner's step. */
  readonly personaId: string | null;
  readonly checkpoint: boolean;
  readonly notify: boolean;
  /** The interactive entry (`<persona>:shape`): the card calls it Shape. */
  readonly shape: boolean;
}

/** The human persona's id: the owner's own step. */
export const OWNER_PERSONA = 'you';

/**
 * The ticket's chain for the strip: the persona list in the ticket's own
 * `chain:` (or the board's standard `flow:` for a ticket without one),
 * folded around the cursor `at` (`chainSteps`). A step names its persona by
 * the entry; the owner's persona (`you`) is the checkpoint.
 */
export function chainOf(input: {
  readonly pipeline: readonly PipelinePhase[];
  readonly currentPhaseId: string;
  readonly card: TicketCard;
  readonly personas: readonly PersonaName[];
  /** The standard flow (`BoardSnapshot.flow`), shown while the ticket has no chain of its own. */
  readonly flow?: readonly ChainEntry[];
}): ChainItem[] {
  const { pipeline, card } = input;
  const own = card.meta.chain ?? [];
  const entries = own.length > 0 ? own : (input.flow ?? []);
  const nameOf = (id: string): string => input.personas.find((p) => p.id === id)?.title ?? titleCase(id);
  if (entries.length === 0) {
    return phaseChainOf(pipeline, input.currentPhaseId);
  }
  const cursor = chainCursor(entries, card.meta.at, chainLifeOf(input.currentPhaseId, pipeline.map((p) => p.id)));
  return chainSteps(entries, cursor).map((step) => {
    const checkpoint = step.persona === OWNER_PERSONA;
    return {
      phase: step.persona,
      position: step.position,
      title: nameOf(step.persona),
      state: step.state,
      who: checkpoint ? OWNER_PERSONA : nameOf(step.persona),
      personaId: checkpoint ? null : step.persona,
      checkpoint,
      notify: step.notify,
      shape: step.mode === 'shape',
    };
  });
}

/**
 * A ticket with neither a chain of its own nor a standard flow (`flow:`
 * absent, every ticket from before req-266): the pipeline's inner columns
 * as the steps — the owner's checkpoints.
 */
function phaseChainOf(pipeline: readonly PipelinePhase[], currentPhaseId: string): ChainItem[] {
  const first = pipeline[0]?.id ?? null;
  const last = pipeline[pipeline.length - 1]?.id ?? null;
  const shown = pipeline.filter((phase) => phase.id !== first && phase.id !== last);
  const at = shown.findIndex((phase) => phase.id === currentPhaseId);
  return shown.map((phase, index) => ({
    phase: phase.id,
    position: index + 1,
    title: phase.title,
    state: at < 0 ? 'future' : index < at ? 'past' : index === at ? 'current' : 'future',
    who: OWNER_PERSONA,
    personaId: null,
    checkpoint: true,
    notify: false,
    shape: false,
  }));
}

export type StatusTone = 'needs' | 'running' | 'blocked' | 'idle';

/** The colour of the status pill: the boards' one colour per state. */
export type PillTone = 'accent' | 'pink' | 'peach' | 'mint' | 'amber' | 'grey';

export interface TicketStatus {
  /** The pill: why the owner is needed, `Running`, `Blocked`, or the phase's title. */
  readonly label: string;
  readonly tone: StatusTone;
  readonly pill: PillTone;
  /** The word for why the owner is wanted when the pill is the generic `Needs you` (`Question`, `Gate red`); '' otherwise. */
  readonly kind: string;
}

const pillOfPhase = (phaseId: string): PillTone => (phaseId === 'prioritized' ? 'accent' : 'grey');

/**
 * The status pill of a ticket on the board (boards 9a, 7b, 7c, 7j): the phase's
 * title in its colour, or the word the owner is wanted for.
 */
export function statusOf(i18n: I18n, row: WorkRow | null, board: BoardSnapshot, phaseTitle: string): TicketStatus {
  const phaseId = row?.phase.id ?? board.pipeline.find((phase) => phase.title === phaseTitle)?.id ?? '';
  if (row === null) {
    return { label: phaseTitle, tone: 'idle', pill: pillOfPhase(phaseId), kind: '' };
  }
  if (row.need !== null) {
    const kind = needKindLabel(row.need, board);
    if (kind === 'Ready to try') {
      return { label: i18n.t('ticket.status.ready_to_try'), tone: 'needs', pill: 'mint', kind: '' };
    }
    return { label: i18n.t('ticket.status.needs_you'), tone: 'needs', pill: 'peach', kind };
  }
  if (row.run !== null) {
    return { label: i18n.t('ticket.status.running'), tone: 'running', pill: 'accent', kind: '' };
  }
  if (row.card.blocked.length > 0) {
    return { label: i18n.t('ticket.status.blocked'), tone: 'blocked', pill: 'amber', kind: '' };
  }
  return { label: phaseTitle, tone: 'idle', pill: pillOfPhase(phaseId), kind: '' };
}

// --- the card: which shape, the flow row, the worker -------------------------

/**
 * Which board a ticket's page follows (owner ruling on Q1, wave 4.3): Inbox and
 * Prioritized are board 9a (card with Priority / Worker / Flow / Repo, body 16/26
 * in 660), Shaping and later row 7 (card with Flow / Worker / Cost, body 15/24 in 720).
 */
export type PageShape = 'early' | 'flow';

export function pageShapeOf(phaseId: string | null, pipeline: readonly PipelinePhase[]): PageShape {
  return phaseId === 'prioritized' || (phaseId !== null && phaseId === pipeline[0]?.id) ? 'early' : 'flow';
}

export interface FlowItem {
  readonly title: string;
  readonly state: ChainItem['state'];
  /** The grey words after the current step: `(with you)`, `(waits for you)`, `(your turn)`. */
  readonly note: string | null;
}

/**
 * The card's Flow row: the chain in the words of the boards; the last owner
 * checkpoint is the `Accept` of decision 26.
 */
export function flowItemsOf(i18n: I18n, chain: readonly ChainItem[]): FlowItem[] {
  const lastCheckpoint = chain.map((step) => step.checkpoint).lastIndexOf(true);
  return chain.map((step, index) => ({
    title: index === lastCheckpoint ? i18n.t('ticket.flow.accept') : step.shape ? i18n.t('ticket.flow.shape') : step.title,
    state: step.state,
    note: step.state === 'current' && step.checkpoint ? i18n.t('ticket.flow.your_turn') : null,
  }));
}

/**
 * Who the card names as the worker: the persona on the current step, else the
 * last one that worked, else the first one that will.
 */
export function workerOf(chain: readonly ChainItem[]): ChainItem | null {
  const machine = chain.filter((step) => !step.checkpoint && step.who !== '');
  return (
    machine.find((step) => step.state === 'current') ??
    [...machine].reverse().find((step) => step.state === 'past') ??
    machine[0] ??
    null
  );
}

export interface CostSummary {
  /** `$1.84 in total` / `$1.20 so far`; null while nothing readable was spent. */
  readonly label: string | null;
  readonly total: number | null;
}

/** The strip's cost slot: `so far` while the ticket is still being worked, `in total` once it waits on the owner — a bare amount always says what it is. */
export function costSummary(i18n: I18n, entries: readonly VerlaufEntry[], waiting: boolean): CostSummary {
  let sum = 0;
  for (const entry of entries) {
    if (typeof entry.cost === 'number' && Number.isFinite(entry.cost) && entry.cost > 0) {
      sum += entry.cost;
    }
  }
  if (sum <= 0) {
    return { total: null, label: null };
  }
  return { total: sum, label: waiting ? costInTotalText(i18n, sum) : costSoFarText(i18n, sum) };
}

/** The persona that does the current step, when the pipeline or the ticket names one. */
export function currentStep(chain: readonly ChainItem[]): ChainItem | null {
  return chain.find((item) => item.state === 'current') ?? null;
}

// --- the action bar ---------------------------------------------------------

export interface ActionBar {
  /** True while the ticket waits on the owner at a checkpoint: the bar then links to the decision card. */
  readonly decide: boolean;
  /** The accept button's words (`Accept and move to Commit`); the decision card's, not the bar's (req-97). */
  readonly acceptLabel: string;
  /** The ticket the link points at; null without a row. */
  readonly ticketId: string | null;
}

/**
 * The bar under the ticket. Accept names the column it moves the ticket to
 * (`Accept and move to Commit`); at the last configured column it is plain
 * `Accept` (the archive). The bar draws no Accept itself: for a ticket at an
 * owner checkpoint (`decide`) it links to the decision card (req-97).
 */
export function actionBarOf(row: WorkRow | null, board: BoardSnapshot): ActionBar {
  const decide = row !== null && row.need !== null && row.need.kind === 'checkpoint';
  const phaseId = row?.phase.id ?? null;
  const configured = board.columns.filter((column) => !column.unknown);
  const index = configured.findIndex((column) => column.phase.id === phaseId);
  const next = index >= 0 ? configured[index + 1] : undefined;
  return { decide, acceptLabel: next === undefined ? 'Accept' : `Accept and move to ${next.phase.title}`, ticketId: row === null ? null : row.card.id };
}
