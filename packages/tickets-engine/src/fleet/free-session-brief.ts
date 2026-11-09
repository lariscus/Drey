/**
 * The free session brief (req-173, R12): what a free session is told once,
 * with the owner's first line — who it is (the persona's instructions and
 * skills), where it works and what it may do there. No board, no ticket,
 * no memory: the owner directs it line by line. Every text here is in
 * `specs/classifier-spec.md` ("The free session brief").
 */
import type { PermissionMode } from './protocol';
import { skillsSection } from './skills-section';

export interface FreeSessionBriefInput {
  readonly title: string;
  readonly role: string;
  /** `prompt.md`; empty = none. */
  readonly prompt: string;
  readonly skills: readonly { readonly name: string; readonly text: string }[];
  readonly workingDirectory: string;
  readonly permissionMode: PermissionMode;
  /** The directory is the tickets repository itself (an allowed directory, R12). */
  readonly ticketsVault: boolean;
}

const MAY: Readonly<Record<PermissionMode, string>> = {
  'read-only': 'Read-only: read what you need, never edit a file, never run a command that changes anything.',
  'accept-edits': 'You may edit files here; ask before anything that reaches beyond this folder.',
  bypass: 'You run without permission prompts; stay inside this folder and do only what the owner asked.',
};

function header(input: FreeSessionBriefInput): string {
  const lines = [
    `# Free session with ${input.title}`,
    '',
    `You are ${input.title}, the ${input.role} of this crew. The owner opened this session for work of their own: there is no ticket, no gate and nothing moves on the board. Do what the owner asks, in their words; say when you are done and wait for the next line.`,
    '',
    `You work in ${input.workingDirectory}. ${MAY[input.permissionMode]}`,
  ];
  if (input.ticketsVault) {
    lines.push('', 'This folder is the tickets repository: its ticket files and `_meta/` are the board — change them only when the owner asks you to.');
  }
  return lines.join('\n');
}

function section(title: string, body: string): string {
  return `## ${title}\n\n${body.trim()}`;
}

/** The brief as one text; empty sections are left out. */
export function composeFreeSessionBrief(input: FreeSessionBriefInput): string {
  const parts: (string | null)[] = [
    header(input),
    input.prompt.trim() === '' ? null : section('Your instructions', input.prompt),
    skillsSection(input.skills),
  ];
  return parts.filter((part): part is string => part !== null).join('\n\n');
}
