import { EXTENSION_KEYS } from './extension-keys';
import { ACTIVE_STAGE, EDGE_STAGES, PHASE_PIN_KEY, RUNNING_STAGE } from '../core/lifecycle-stages';
import { stringify } from 'yaml';
import { TICKETS_ARCHIVE_DIR, type BoardSnapshot, type PipelinePhase } from '../contracts/tickets';
import type { TicketDetail } from '../ports/ticket-store';
import { ARCHIVED_LABEL, PLACEHOLDER_LABEL } from './legacy-bridge';
import { assembleBoard, type AssembleInput, type BoardFile } from '../core/ticket-board';
import { recentDoneOf } from '../core/normalize';
import { statusLinesOfComments } from '../core/status-comment';
import { openStatusItems } from '../core/status-log';
import { chainColumnOf, placementColumnsOf, type PlacementColumns } from '../core/chain-placement';
import { crewLookupOf, type PersonaLookup } from '../core/chain-holder';
import { parseTicketChainFields } from '../core/ticket-chain-fields';

/**
 * The board over a store's `TicketDetail[]` instead of ticket files (E14-2,
 * ADR-0090). Pure: no IO, no `dk`.
 *
 * The one rule that keeps both backends equal by construction: a record is
 * folded back into the LEGACY ticket shape (front matter `phase directory +
 * Drey keys`) and then runs through the very same `assembleBoard` — column
 * membership, derived order, `blocked` / `blocks`, issues and card workers are
 * therefore computed by one piece of code, not two. What this module owns is
 * only the translation of dricket's vocabulary into Drey's (below).
 *
 * Field map (dricket -> Drey ticket key):
 *
 *   id, title, priority            -> same
 *   stage, x-chain, x-at           -> phase (see {@link resolvePhase}; `x-phase` only without a chain)
 *   depends                        -> blocked-by   (blocked is derived, never stored)
 *   parent                         -> parent
 *   repos                          -> repos
 *   owner, claimed_at              -> claimed-by, claimed-at
 *   x-rank                         -> rank
 *   x-worker x-persona x-track     -> worker persona track
 *   x-form x-proof x-awaiting      -> form proof awaiting
 *   x-class x-model x-size         -> class model size     (req-170)
 *   x-allowance                    -> allowance            (req-170)
 *   x-project                      -> project              (req-282)
 *   x-interactive                  -> interactive          ("true")
 *   x-chain                        -> chain                (entries separated by `;`)
 *   x-references                   -> references           (separated by `,`)
 *   x-entered-<phase>              -> entered-<phase>
 *
 * Not carried: `branch` (the rule `t/<id>` wins in the reader anyway), `run`
 * (the runner's process table, not ticket data), `parked-*` (a parked ticket
 * is stage `blocked`, migration plan §3), labels / kind / size / epoch / rev /
 * lease (dricket data the legacy board has no field for).
 */

export { EXTENSION_KEYS } from './extension-keys';

export interface RecordsBoardInput extends Omit<AssembleInput, 'files'> {
  readonly records: readonly TicketDetail[];
  /** The tickets' comments by id (the read of `comments/` is the caller's): the source of the snapshot's `openStatus` (D-12). */
  readonly comments?: ReadonlyMap<string, readonly { readonly at: string; readonly text: string }[]>;
  /**
   * req-257: the crew's persona kinds, so the column of an `active` / `running` ticket follows its
   * holder ({@link resolvePhase}). Absent = every named persona counts as readable.
   */
  readonly crew?: ReadonlyMap<string, 'agent' | 'human' | 'mission'>;
}

/** What {@link resolvePhase} needs to place a chain ticket by its holder (req-257). */
export interface HolderPlacement {
  readonly columns: PlacementColumns;
  readonly lookup: PersonaLookup;
}

export interface PhaseResolution {
  readonly phase: string;
  /** True when the stage matched no pipeline phase and stays as it is (an unknown column). */
  readonly unmapped: boolean;
}

/**
 * Which pipeline column a record belongs to.
 *
 *  1. a lifecycle edge stage (`inbox`, `prioritized`, `done`) that is a pipeline
 *     phase: that column — the edges never take a pin (req-265);
 *  2. `x-phase` when it names a pipeline phase: req-265's interim column pin on
 *     a ticket the stage migration has not turned into a cursor yet, and
 *     variant B of the migration plan (dricket's built-in stages with the
 *     phase kept beside them) — nothing writes the pin any more (req-257);
 *  3. an `active` / `running` ticket with a readable chain: the column of its
 *     holder (req-257, `core/chain-placement.ts`) — the cursor `x-at` took the
 *     pin's place; a pipeline with no column for the holder shows the stage
 *     itself (one "active" column);
 *  4. the stage itself when it is a pipeline phase id (variant A: `[stages]` in
 *     `dricket.toml` lists the phase ids — a store not yet migrated);
 *  5. by role: `active` / `running` / `in-progress` -> the first claiming column,
 *     `open` / `blocked` -> the capture column, `review` -> `commit` (else the
 *     column before the terminal one), `done` / `cancelled` -> the terminal column;
 *  6. otherwise the raw stage: the board shows it as an unknown column with a
 *     warning, exactly like a stray directory.
 */
export function resolvePhase(record: TicketDetail, phases: readonly PipelinePhase[], placement?: HolderPlacement): PhaseResolution {
  const ids = phases.map((p) => p.id);
  if (EDGE_STAGES.includes(record.stage) && ids.includes(record.stage)) {
    return { phase: record.stage, unmapped: false };
  }
  const pinned = record.extensions[PHASE_PIN_KEY];
  if (pinned !== undefined && ids.includes(pinned)) {
    return { phase: pinned, unmapped: false };
  }
  const held = holderColumnOf(record, placement ?? { columns: placementColumnsOf(phases), lookup: crewLookupOf(undefined) });
  if (held !== undefined) {
    return held === null ? { phase: record.stage, unmapped: true } : { phase: held, unmapped: false };
  }
  if (ids.includes(record.stage)) {
    return { phase: record.stage, unmapped: false };
  }
  const role = roleColumn(record.stage, phases);
  return role === undefined ? { phase: record.stage, unmapped: true } : { phase: role, unmapped: false };
}

/** The holder's column of an `active` / `running` record with a readable chain (null = none in this pipeline); undefined = no chain ticket. */
function holderColumnOf(record: TicketDetail, placement: HolderPlacement): string | null | undefined {
  if (record.stage !== ACTIVE_STAGE && record.stage !== RUNNING_STAGE) {
    return undefined;
  }
  const x = record.extensions;
  const fields = parseTicketChainFields({ chain: x['x-chain'], at: x['x-at'] }, [], false);
  if (fields.chain === undefined) {
    return undefined;
  }
  return chainColumnOf({ stage: record.stage, chain: fields.chain, at: fields.at, awaiting: x['x-awaiting'] }, placement.lookup, placement.columns);
}

/** The column a stage that is no pipeline phase stands for, by its role; undefined = none. */
function roleColumn(stage: string, phases: readonly PipelinePhase[]): string | undefined {
  const ids = phases.map((p) => p.id);
  if (CAPTURE_ROLES.includes(stage)) {
    return ids[0];
  }
  if (CLAIM_ROLES.includes(stage)) {
    return phases.find((p) => p.claim)?.id ?? ids[1];
  }
  if (TERMINAL_ROLES.includes(stage)) {
    return ids[ids.length - 1];
  }
  if (stage !== 'review') {
    return undefined;
  }
  return ids.includes('commit') ? 'commit' : ids.length >= 3 ? ids[ids.length - 2] : undefined;
}

const CAPTURE_ROLES: readonly string[] = ['open', 'blocked'];
const CLAIM_ROLES: readonly string[] = [ACTIVE_STAGE, RUNNING_STAGE, 'in-progress'];
const TERMINAL_ROLES: readonly string[] = ['done', 'cancelled'];

/** One record as the legacy ticket file the board reader understands. */
export function recordToBoardFile(record: TicketDetail, phase: string): BoardFile {
  const x = record.extensions;
  const header: Record<string, unknown> = { id: record.id, title: record.title, ...placeFieldsOf(record), ...extensionFieldsOf(x), ...linkFieldsOf(record), ...enteredFieldsOf(x) };
  const yaml = stringify(header, { lineWidth: 0 });
  return { path: `tickets/${phase}/${record.id}.md`, text: `---\n${yaml}---\n${record.body}` };
}

/** dricket's repos and priority. */
function placeFieldsOf(record: TicketDetail): Record<string, unknown> {
  const header: Record<string, unknown> = {};
  if (record.repos.length > 0) {
    header['repos'] = [...record.repos];
  }
  if (record.priority !== null) {
    header['priority'] = record.priority;
  }
  return header;
}

/** dricket's links in Drey's names: blocked-by, the claim, parent. */
function linkFieldsOf(record: TicketDetail): Record<string, unknown> {
  const header: Record<string, unknown> = {};
  if (record.dependsOn.length > 0) {
    header['blocked-by'] = [...record.dependsOn];
  }
  if (record.owner !== null) {
    header['claimed-by'] = record.owner;
    if (record.claimedAt !== null) {
      header['claimed-at'] = record.claimedAt;
    }
  }
  if (record.parent !== null) {
    header['parent'] = record.parent;
  }
  return header;
}

/** The `x-` fields in Drey's names: rank, the extension keys, interactive, chain, references. */
function extensionFieldsOf(x: Readonly<Record<string, string>>): Record<string, unknown> {
  const header: Record<string, unknown> = {};
  const rank = x['x-rank'];
  if (rank !== undefined && rank !== '') {
    header['rank'] = /^\d+$/.test(rank) ? Number(rank) : rank;
  }
  for (const key of EXTENSION_KEYS) {
    const value = x[`x-${key}`];
    if (value !== undefined && value !== '') {
      header[key] = value;
    }
  }
  if (x['x-interactive'] === 'true') {
    header['interactive'] = true;
  }
  const lists = { chain: splitOn(x['x-chain'], ';'), references: splitOn(x['x-references'], ',') };
  for (const [key, list] of Object.entries(lists)) {
    if (list.length > 0) {
      header[key] = list;
    }
  }
  return header;
}

function enteredFieldsOf(x: Readonly<Record<string, string>>): Record<string, unknown> {
  const header: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(x)) {
    const entered = /^x-entered-([a-z][a-z0-9-]*)$/.exec(key);
    if (entered !== null && value !== '') {
      header[`entered-${entered[1]}`] = value;
    }
  }
  return header;
}

function splitOn(value: string | undefined, separator: string): string[] {
  return value === undefined
    ? []
    : value
        .split(separator)
        .map((s) => s.trim())
        .filter((s) => s !== '');
}

/**
 * The board snapshot from store records. Same pipeline / repos / ledger inputs
 * as the file path (those stay in the meta vault); only the tickets differ.
 * A record whose stage matches no column is shown in an unknown column — the
 * assembler's existing "directory is not a phase" warning covers it.
 */
export function assembleBoardFromRecords(input: RecordsBoardInput): BoardSnapshot {
  // The phases are needed to place records, and are parsed by `assembleBoard`
  // later anyway; a first assembly with no tickets gives them without a second parser.
  const probe = assembleBoard({ ...input, files: [], recentDone: [] });
  // An accepted (archived) ticket is off the board, like a file in tickets/archive/ (E14-4b: the archive is a label);
  // so is an import placeholder, which only keeps a legacy number free (shadow run, E14-2 follow-up).
  const onBoard = input.records.filter((record) => !record.labels.includes(ARCHIVED_LABEL) && !record.labels.includes(PLACEHOLDER_LABEL));
  const placement: HolderPlacement = { columns: placementColumnsOf(probe.pipeline), lookup: crewLookupOf(input.crew) };
  const files = onBoard.map((record) => {
    const { phase } = resolvePhase(record, probe.pipeline, placement);
    return recordToBoardFile(record, phase);
  });
  // Done this week (E13-21): the archive is a label here, so the same window the files
  // board reads from `tickets/archive/` is read from the archived records' Log stamps.
  const board = assembleBoard({ ...input, files, recentDone: input.recentDone ?? recentDoneOf(archivedRecordFiles(input.records), Date.now()) });
  const comments = input.comments;
  if (comments === undefined) {
    return board;
  }
  // Needs you on every client (D-12): an open decision of a ticket on the board, from the snapshot alone.
  const openStatus = onBoard.flatMap((record) =>
    openStatusItems(statusLinesOfComments(comments.get(record.id) ?? [])).map((item) => ({ ticketId: record.id, ...item })),
  );
  return { ...board, openStatus };
}

/** The archived records as the archive files the files board would hold (E13-21). */
export function archivedRecordFiles(records: readonly TicketDetail[]): { path: string; text: string }[] {
  return records
    .filter((record) => record.labels.includes(ARCHIVED_LABEL))
    .map((record) => ({ path: `${TICKETS_ARCHIVE_DIR}/${record.id}.md`, text: recordToBoardFile(record, 'archive').text }));
}
