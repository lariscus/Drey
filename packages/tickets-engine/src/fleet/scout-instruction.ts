// ---------------------------------------------------------------------------
// The scout run's brief (E8, concept §5.6): exploration only — no worktree,
// no branch, no gate, no move. Where the ship brief names a writable
// checkout and a machine gate, the scout brief names a READ ground, the
// ticket file as the one writable place, and the exact `## Report` shape
// the engine reads back for the "Needs you" report card.

import type { InteractiveMode } from './protocol';
import type { DisciplineTexts } from './discipline-texts';
import { expandFragments } from '../core/prompt-file';
import { briefHead, headParts, memoryOf, optional, personaLine, trimmed, type ComposedInstruction } from './instruction-parts';

/**
 * The report chapter's exact shape — the strict writer's grammar of
 * `core/scout.ts`, spelled out for the worker. The reader forgives, so
 * the writer must not improvise: headings verbatim, decisions numbered
 * D1, D2, …, every line left `- [ ]` for the owner to check.
 */
function scoutReportShape(by: string): string {
  return (
    'The report chapter — replace the ticket file\'s whole `## Report` section with exactly this shape (headings verbatim):\n\n' +
    `## Report\n\nWritten on <UTC stamp, YYYY-MM-DDTHH:mm:ssZ> by ${by}.\n\n### Summary\n\n` +
    '<what you found: the facts, the options, the trade-offs — what the owner must know to decide>\n\n### Decisions\n\n' +
    '- [ ] D1: <the question the owner must decide> — Recommendation: <your recommendation>\n' +
    '- [ ] D2: <the next decision, in the order the owner should decide them> — Recommendation: <…>\n\n' +
    'Every decision line stays `- [ ]` unchecked — the owner checks them when deciding; a line without a recommendation ' +
    'omits the ` — Recommendation: …` tail. No decisions open is a legitimate report: omit the whole `### Decisions` ' +
    'heading when nothing stays open.'
  );
}

export interface ScoutInstructionInput {
  /**
   * The discipline texts the scout brief ends with (`prompts/disciplines/`,
   * req-279) — loaded once by the composer's caller and carried here, so
   * the pure composer reads no files.
   */
  readonly disciplines: DisciplineTexts;
  readonly ticketId: string;
  readonly title: string;
  /**
   * The read ground's absolute path — the named repo's checkout, or the
   * tickets vault itself when the ticket names no repo. Read-only; the
   * brief forbids writing there.
   */
  readonly readGround: string;
  /** The read ground's repo name (`drey`); null = the tickets vault. */
  readonly repoName: string | null;
  /** Absolute path of the ticket file — the one writable place. */
  readonly ticketFile: string;
  readonly phase: string;
  readonly description: string;
  readonly plan: string | null;
  /** A resolved persona's prompt; null = the built-in scout brief only. */
  readonly prompt: string | null;
  /** The read ground's agent instructions, verbatim like the ship brief. */
  readonly repoInstructions: string | null;
  /** The ticket's further repos: read-only grounds, never write there. */
  readonly extraRepos?: readonly { readonly name: string; readonly path: string }[];
  /** The resolved persona's `## Skills` section (D-46); absent = no section. */
  readonly skillsSection?: string | null;
  /** The resolved persona's `## Memory` slice (E3); absent = no section. */
  readonly memorySection?: string | null;
  /** The persona id the Written-on line signs with; null/'' = `scout`. */
  readonly personaId?: string | null;
  /** The persona's role for the brief's persona line (D-60). */
  readonly personaRole?: string | null;
  /**
   * An interactive dialog on a scout ticket: the dialog discipline
   * replaces the scout discipline, everything else stands.
   */
  readonly interactive?: InteractiveMode;
}

/**
 * Composes the scout run's brief in the context-pack order — stable
 * first (repo instructions, the persona prompt, `## Plan`), then the
 * variable parts (who/where, the read ground, the ticket file, the
 * description, the persona's memory, the report's shape, the
 * discipline, how to ask). No gate commands, no diff stat, no gate
 * failure: a scout run has no branch and no gate to fail.
 */
export function composeScoutInstruction(input: ScoutInstructionInput): ComposedInstruction {
  const head = briefHead({ ...input, prompt: expandFragments(input.prompt, input.disciplines.fragments) });
  const description = input.description.trim();
  const changing = optional(memoryOf(input.memorySection));
  const signedBy = trimmed(input.personaId);
  const discipline = input.interactive !== undefined ? input.disciplines.interactive : input.disciplines.scout;
  const d = input.disciplines;
  const parts = [
    ...headParts(head),
    ...scoutWhoAndWhere(input, description),
    d.working,
    d.language,
    d.precedence,
    ...changing,
    scoutReportShape(signedBy !== '' ? signedBy : 'scout'),
    discipline,
    d.signals,
    d.asking,
  ];
  const continuation = [
    `You are resuming the exploration of ticket ${input.ticketId} — ${input.title}, the scout run, in this same session. ` +
      `Your full brief for this exploration is earlier in this conversation and still holds — do not re-read what it already ` +
      `told you. Read ground: ${input.readGround} (read-only). Your one writable place stays the ticket file: ${input.ticketFile}.`,
    ...changing,
    'The report\'s shape stands: `## Report` with the Written-on line, `### Summary`, `### Decisions` of ' +
      '`- [ ] Dn: <question> — Recommendation: <yours>` — unchecked, in the order the owner should decide them.',
    discipline,
    d.signals,
  ].join('\n\n');
  const stable = JSON.stringify([
    head.repoInstructions,
    head.prompt,
    head.plan,
    description,
    'scout',
    input.readGround,
    ...(head.skills !== '' ? [head.skills] : []),
  ]);
  return { text: parts.join('\n\n'), truncations: [], continuation, stable };
}

/** Who/where of a scout run: the ticket, the persona, the read grounds, the phase, the ticket file, the description. */
function scoutWhoAndWhere(input: ScoutInstructionInput, description: string): string[] {
  const extraRepos = input.extraRepos ?? [];
  return [
    `You are scouting ticket ${input.ticketId} — ${input.title}. Exploration only: you change nothing in any repo — ` +
      'no edits, no commits, no branch.',
    ...optional(personaLine(input.personaId, input.personaRole)),
    `Read ground: ${input.readGround}` +
      (input.repoName !== null ? ` (the "${input.repoName}" checkout)` : ' (the tickets vault)') +
      ' — read-only; never write there. Its git history and every data file in it are fair game.',
    ...(extraRepos.length > 0
      ? [`Further repositories this ticket names — read-only grounds, never write there:\n${extraRepos.map((r) => `- ${r.name}: ${r.path} (read-only)`).join('\n')}`]
      : []),
    `The ticket sits in the "${input.phase}" phase of the owner's board — it stays there; this run moves nothing.`,
    `The ticket file: ${input.ticketFile} — the ONE file you may edit. The report chapter goes into it; ` +
      'nothing else in the vault or any repo is yours to write.',
    ...(description !== '' ? [`What and why:\n${description}`] : []),
  ];
}
