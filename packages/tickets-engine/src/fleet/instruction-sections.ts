/**
 * The variable sections of the ship brief (`instruction.ts`): who and
 * where the worker is, then the parts that change between runs of one
 * step — the persona's memory, the earlier handover, the diff stat and the
 * previous gate failure (the latter two capped, the capping reported).
 */
import type { InstructionInput } from './instruction';
import { capHead, capTail } from './capping';
import { memoryOf, optional, trimmed, type Truncation } from './instruction-parts';
import { isReadOnlyRun } from './review-run';

/** The most of an earlier handover the brief carries. */
const HANDOVER_CAP = 2_000;

/** What `whoAndWhere` needs beyond the input, already resolved by the caller. */
export interface WhoAndWhereContext {
  readonly persona: string | null;
  /** The trimmed plan; '' when absent. */
  readonly plan: string;
  /** The trimmed description. */
  readonly description: string;
}

/** Who/where: the ticket, the persona, the checkouts, the phase, the toolchain, the ticket file, the description. */
export function whoAndWhere(input: InstructionInput, context: WhoAndWhereContext): string[] {
  return [
    `You are working ticket ${input.ticketId} — ${input.title}.`,
    ...optional(context.persona),
    checkoutLine(input),
    ...optional(extraReposPart(input)),
    `The ticket sits in the "${input.phase}" phase of the owner's board.`,
    ...optional(toolchainPart(input.links)),
    ...ticketFileParts(input, context.plan),
    ...(context.description !== '' ? [`What and why:\n${context.description}`] : []),
  ];
}

/** Where the worker works — or, on a review run (req-183), the read-only checkout it judges. */
function checkoutLine(input: InstructionInput): string {
  const repo = input.repo !== null ? `, repo ${input.repo}` : '';
  if (input.reviewCheckout !== undefined) {
    return (
      `Review checkout: ${input.reviewCheckout} (branch ${input.branch} at the commit the builder handed over, detached${repo}). ` +
      'It is read-only, and so is your session.'
    );
  }
  return `Work checkout: ${input.worktreePath} (branch ${input.branch}${repo}). Stay on that branch.`;
}

function extraReposPart(input: InstructionInput): string | null {
  if (input.extraRepos === undefined || input.extraRepos.length === 0) {
    return null;
  }
  const lines = input.extraRepos.map((r) => `- ${r.name}: ${r.worktreePath}${r.base !== null ? ` (base ${r.base})` : ''}`);
  return (
    `Further repositories this ticket names, each prepared as its own worktree on the same branch (${input.branch}) — ` +
    `work and commit there too when the step touches them:\n${lines.join('\n')}`
  );
}

function toolchainPart(links: readonly string[] | undefined): string | null {
  if (links === undefined || links.length === 0) {
    return null;
  }
  // Workers used to probe for the toolchain and improvise — junctions
  // of their own, even an install — in every run (req-56).
  return (
    `Toolchain: ${links.map((l) => `\`${l}\``).join(', ')} ${links.length === 1 ? 'is' : 'are'} linked into the ` +
    `checkout from the repo's main folder, ready to use. Do not run an install (npm ci, npm install, …) and do not ` +
    `create or replace links: the folders are shared with the owner's checkout.`
  );
}

/** The ticket file's line and the note that the brief already quotes it — nothing without a ticket file. */
function ticketFileParts(input: InstructionInput, plan: string): string[] {
  const ticketFile = input.ticketFile;
  if (ticketFile === undefined || ticketFile === '') {
    return [];
  }
  if (isReadOnlyRun(input)) {
    // req-183/req-280: a read-only run's ticket file is there to read, never to edit (the read-only discipline says so).
    return [`The ticket file: ${ticketFile} — read it if you need more than this brief quotes.`];
  }
  // req-280: what the file is and who writes which section is the ticket-file discipline's; this line is the path.
  const fileLine = `The ticket file: ${ticketFile}. Use this path directly; do not search the disk for another ticket file.`;
  // The worker re-read the whole ticket file first thing in every run
  // (req-55): a second copy of what this brief already carries, paid
  // again by every model call of the run.
  const quoted =
    "The ticket's description" +
    (plan !== '' ? ' and plan are' : ' is') +
    ' quoted in full in this brief — do not read the ticket file to learn them. When you edit it, read only the ' +
    'section you change (the Log is at its end: read its last lines).';
  return [fileLine, quoted];
}

/** The parts that change between runs of one step, in brief order; each capping lands in `truncations`. */
export function changingParts(input: InstructionInput, truncations: Truncation[]): string[] {
  return [
    ...optional(memoryOf(input.memorySection)),
    ...optional(handoverPart(input.handover)),
    ...optional(diffStatPart(input, truncations)),
    ...optional(gateFailurePart(input, truncations)),
  ];
}

function handoverPart(raw: string | undefined): string | null {
  const handover = trimmed(raw);
  if (handover === '') {
    return null;
  }
  return `The earlier step's handover (written by the worker before you — trust it, check only what it marks Open):\n\n${handover.slice(0, HANDOVER_CAP)}`;
}

function diffStatPart(input: InstructionInput, truncations: Truncation[]): string | null {
  const raw = input.diffStat ?? '';
  if (raw.trim() === '') {
    return null;
  }
  const capped = capHead(raw, { lines: input.caps.diffStatLines, bytes: input.caps.diffStatBytes });
  if (capped.truncated) {
    truncations.push({ section: 'diffStat', originalSize: capped.originalSize });
  }
  return `The branch so far (committed since it left the base, then uncommitted):\n\n${capped.text}`;
}

function gateFailurePart(input: InstructionInput, truncations: Truncation[]): string | null {
  const raw = input.gateFailure ?? '';
  if (raw.trim() === '') {
    return null;
  }
  const capped = capTail(raw, { lines: input.caps.gateFailureLines, bytes: input.caps.gateFailureBytes });
  if (capped.truncated) {
    truncations.push({ section: 'gateFailure', originalSize: capped.originalSize });
  }
  return (
    `The previous run failed the machine gate — fix this first. The branch already holds the earlier work, ` +
    `so continue from the existing diff instead of starting over. The failure's tail:\n\n${capped.text}`
  );
}
