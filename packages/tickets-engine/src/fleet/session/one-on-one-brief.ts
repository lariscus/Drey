/**
 * The 1:1 brief (req-168, ADR-0093, R2): what a persona's 1:1 session is
 * told once, with the owner's first line — its profile, its instructions
 * and skills, its memory, the conversation so far and a short list of its
 * latest runs. The board is NOT embedded: the persona reads it with its
 * tools. A tool is named only when it is attached (ADR-0071's rule). Every
 * text here is in `specs/classifier-spec.md` ("The 1:1 brief").
 */
import { skillsSection } from '../runner/skills-section';

/** One of the persona's latest runs, as the brief lists it. */
export interface BriefRun {
  readonly ticketId: string;
  /** `done`, `failed`, `stopped`, or the live state. */
  readonly state: string;
  readonly costUsd: number | null;
  readonly gateFailure: string | null;
  readonly model: string | null;
}

/** One message of the conversation so far. */
export interface BriefMessage {
  readonly role: 'owner' | 'persona';
  readonly text: string;
}

export interface OneOnOneBriefInput {
  readonly id: string;
  readonly title: string;
  readonly role: string;
  /** `prompt.md`; empty = none. */
  readonly prompt: string;
  readonly skills: readonly { readonly name: string; readonly text: string }[];
  /** `memory.md`; null = the file does not exist. */
  readonly memory: string | null;
  /** Newest first, already cut to the list's length. */
  readonly runs: readonly BriefRun[];
  /** The conversation so far, oldest first (a fresh session after a release reads them here). */
  readonly conversation: readonly BriefMessage[];
  /**
   * req-315: the owner's own instructions (the human persona's `prompt.md`) — Mission Control's persona honors them in
   * how she deals with the owner; absent = none (a board whose owner wrote none). Only she carries the section.
   */
  readonly owner?: { readonly title: string; readonly prompt: string } | null;
  /** The MCP tools attached to this session ({@link OneOnOneToolSeam}). */
  readonly tools: readonly string[];
  readonly workingDirectory: string;
}

/** How many runs the list carries, and how many earlier messages ride along. */
export const BRIEF_RUNS = 5;
export const BRIEF_HISTORY = 30;
const GATE_CHARS = 160;
const MESSAGE_CHARS = 2_000;

const PROPOSALS = [
  '## Proposals',
  '',
  'When you think your instructions or your skills should change, say why in your answer and add one block per change:',
  '',
  '```proposal',
  '{"kind": "prompt", "summary": "<one line>", "text": "<your whole new instructions>"}',
  '```',
  '',
  'or `{"kind": "skill", "summary": "<one line>", "skill": "<the name of a skill to add>"}`. The owner accepts or dismisses each one; nothing changes before that.',
].join('\n');

function header(input: OneOnOneBriefInput): string {
  return [
    `# 1:1 with ${input.title}`,
    '',
    `You are ${input.title}, the ${input.role} of this crew. The owner talks with you 1:1: there is no ticket and nothing to build. Answer as yourself, from your instructions, your memory and your runs — short and plain.`,
    '',
    `You work in the tickets repository (${input.workingDirectory}), read-only: read what you need, never edit a file, never run a command that changes anything. Your own folder is tickets/_meta/personas/${input.id}/.`,
  ].join('\n');
}

function section(title: string, body: string): string {
  return `## ${title}\n\n${body.trim()}`;
}

function money(value: number | null): string | null {
  return value === null ? null : `$${value.toFixed(2)}`;
}

function runLine(run: BriefRun): string {
  const gate = run.gateFailure === null ? null : `gate: ${run.gateFailure.replace(/\s+/g, ' ').slice(0, GATE_CHARS)}`;
  return `- ${[run.ticketId, run.state, run.model, money(run.costUsd), gate].filter((part) => part !== null && part !== '').join(' · ')}`;
}

function conversationOf(messages: readonly BriefMessage[]): string {
  return messages
    .slice(-BRIEF_HISTORY)
    .map((m) => `${m.role === 'owner' ? 'Owner' : 'You'}: ${m.text.slice(0, MESSAGE_CHARS)}`)
    .join('\n\n');
}

/** The tools line per kind of tool, so it never says more than what is attached (ADR-0071). */
function toolsOf(tools: readonly string[]): string | null {
  const fleet = tools.filter((name) => name.startsWith('fleet_'));
  const vault = tools.filter((name) => name.startsWith('vault_'));
  if (fleet.length + vault.length === 0) {
    return null;
  }
  const lines = [
    ...(fleet.length === 0 ? [] : [`Read the crew's runs with: ${fleet.join(', ')}.`]),
    ...(vault.length === 0 ? [] : [`Read the owner's notes (the vault) with: ${vault.join(', ')}.`]),
    'They only read.',
  ];
  return section('Tools', lines.join(' '));
}

/** The brief as one text, sections in a fixed order; empty sections are left out. */
export function composeOneOnOneBrief(input: OneOnOneBriefInput): string {
  const owner =
    input.owner === undefined || input.owner === null || input.owner.prompt.trim() === ''
      ? null
      : section('The owner', `${input.owner.title} is the owner — their own instructions for how you deal with them. Honor it in every answer:\n\n${input.owner.prompt}`);
  const parts: (string | null)[] = [
    header(input),
    input.prompt.trim() === '' ? null : section('Your instructions', input.prompt),
    owner,
    skillsSection(input.skills),
    section('Your memory', input.memory === null || input.memory.trim() === '' ? 'Nothing yet.' : input.memory),
    section('Your latest runs', input.runs.length === 0 ? 'No runs yet.' : input.runs.slice(0, BRIEF_RUNS).map(runLine).join('\n')),
    toolsOf(input.tools),
    input.conversation.length === 0 ? null : section('The conversation so far', conversationOf(input.conversation)),
    PROPOSALS,
  ];
  return parts.filter((part): part is string => part !== null).join('\n\n');
}
