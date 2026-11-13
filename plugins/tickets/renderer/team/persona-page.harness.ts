/**
 * The Persona page specs' shared stand-in for the host: a fake Markdown
 * editor that records what the page asks of it, the deps with the engine
 * replies the page reads, and the queries both specs use. State lives in
 * `fx`, reset before every test by `resetFixture()`; each spec file has its
 * own copy of the module, so nothing leaks between files.
 */
import { vi } from 'vitest';
import type { SkillView } from '../../../../packages/tickets-engine/src/contracts/skills';
import type { RunInfo } from '../../../../packages/tickets-engine/src/fleet/protocol';
import { estimateTokens } from '../../../../packages/tickets-engine/src/core/token-count';
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- the spec stands in for the host, which owns the catalog at runtime
import { i18n } from '../../../../shared/i18n';
import type { MarkdownViewHandle, MarkdownViewOptions } from '../../../../shared/plugin-api/renderer';
import type { PersonaView } from '../../shared/remote-protocol';
import type { BoardSnapshot } from '../../shared/tickets';
import type { DeskDeps } from '../desk-deps';
import { mountPersonaPage, type PersonaPageHost, type PersonaPageSeams } from './persona-page';
import type { TeamStore } from './team-store';
import { skillsOf } from './persona-skills.fixture';

export const view: PersonaView = {
  id: 'ben',
  title: 'Ben',
  role: 'builder',
  worker: 'claude-code',
  model: 'opus',
  pool: ['opus', 'sonnet'],
  color: '#8ecbef',
  budget: 5,
  phases: ['build'],
  summary: 'Builds one part of a ticket, test first.',
  allowed: { spendAboveAllowance: false, writeNotes: true },
  settings: { minClass: 'B', needs: null, maxTurns: null, maxWorkMin: null, gate: null, parallel: 2, min: 0, leaving: ['sync-main'], readOnly: false },
  readOnly: false,
};

export const OPEN_PROPOSAL = { id: 'imp-1', state: 'open', target: 'prompt.md', title: 'Add a line', evidence: ['a', 'b', 'c'], content: 'Suggested prompt', lesson: null, at: '', decidedAt: null };

export const TABLE = {
  ok: true,
  models: [
    { model: 'opus', slot: null, provider: 'claude-code', category: 'frontier', class: 'A', cost: 3, sessions: 2 },
    { model: 'sonnet', slot: null, provider: 'claude-code', category: 'everyday', class: 'B', cost: 1, sessions: 3 },
    { model: 'haiku', slot: null, provider: 'claude-code', category: 'bulk', class: 'C', cost: 0.2, sessions: 3 },
  ],
};
const SLOTS = { ok: true, slots: [{ id: 'claude-a', label: 'Claude A', provider: 'claude-code', busy: 1, total: 3 }] };

export interface FakeView {
  readonly opts: MarkdownViewOptions;
  text: string;
  readOnly: boolean;
  mode: string;
  formats: string[];
  disposed: boolean;
}

export const fx = {
  invoked: [] as [string, unknown][],
  prompt: { text: '' } as { text: string } | { error: Error },
  proposals: [] as unknown[],
  replies: {} as Record<string, unknown>,
  table: TABLE as unknown,
  views: [] as FakeView[],
  showDiff: vi.fn(async () => undefined),
  retitled: [] as string[],
  commands: [] as [string, unknown][],
  backs: 0,
  removed: 0,
  refreshes: 0,
  modal: null as HTMLElement | null,
  host: null as unknown as HTMLElement,
  dispose: null as (() => void) | null,
  failLoads: 0,
  view: {} as Partial<PersonaView>,
  skills: [] as SkillView[],
  missing: [] as string[],
  skillFail: null as { code: string; error: string } | null,
  uploads: [] as unknown[],
  previewFail: false,
  runs: [] as RunInfo[],
};

export function resetFixture(): void {
  fx.invoked = [];
  fx.prompt = { text: '## Who Ben is\n\nCalm.' };
  fx.proposals = [OPEN_PROPOSAL];
  fx.replies = {};
  fx.table = TABLE;
  fx.views = [];
  fx.showDiff = vi.fn(async () => undefined);
  fx.retitled = [];
  fx.commands = [];
  fx.backs = 0;
  fx.removed = 0;
  fx.refreshes = 0;
  fx.modal = null;
  fx.host = document.createElement('div');
  document.body.append(fx.host);
  fx.dispose = null;
  fx.failLoads = 0;
  fx.view = {};
  fx.skills = skillsOf();
  fx.missing = [];
  fx.skillFail = null;
  fx.uploads = [];
  fx.previewFail = false;
  fx.runs = [];
}

export function cleanFixture(): void {
  fx.modal?.remove();
  // A test leaves no draft behind for the next: Discard clears the page's memory of it.
  [...fx.host.querySelectorAll('button')].find((entry) => entry.textContent === 'Discard')?.click();
  fx.dispose?.();
  fx.host.remove();
}

/** The host's modal overlay: the content mounts in a node on the body; the returned close takes it away again. */
function fakeModal(mount: (el: HTMLElement) => void): () => void {
  const el = document.createElement('div');
  el.className = 'fake-modal';
  document.body.append(el);
  fx.modal = el;
  mount(el);
  return () => {
    el.remove();
    fx.modal = fx.modal === el ? null : fx.modal;
  };
}

function fakeView(opts: MarkdownViewOptions): MarkdownViewHandle {
  const fake: FakeView = { opts, text: opts.content ?? '', readOnly: opts.readOnly === true, mode: opts.mode ?? 'live', formats: [], disposed: false };
  const element = document.createElement('div');
  element.className = 'fake-editor';
  fx.views.push(fake);
  return {
    element,
    setContent: (text) => {
      fake.text = text;
      opts.onChange?.(text);
    },
    getContent: () => fake.text,
    setReadOnly: (value) => (fake.readOnly = value),
    setMode: (mode) => (fake.mode = mode),
    format: (action) => fake.formats.push(action),
    focus: () => undefined,
    dispose: () => (fake.disposed = true),
  };
}

/** The engine's skill routes over `fx.skills`: a switch, a removal and an upload change it and answer with the new listing. */
function skillReply(method: string, payload: unknown): unknown {
  const body = payload as { skill?: string; on?: boolean; name?: string };
  if (fx.skillFail !== null && method !== 'personaSkills') {
    return { ok: false, ...fx.skillFail };
  }
  if (method === 'personaSkillToggle') {
    fx.skills = fx.skills.map((skill) => (skill.name === body.skill ? { ...skill, on: body.on === true } : skill));
  } else if (method === 'personaSkillRemove') {
    const target = fx.skills.find((skill) => skill.name === body.name);
    if (target?.origin !== 'own') {
      return { ok: false, code: 'not_own', error: 'a shared skill is not deleted from a persona' };
    }
    fx.skills = fx.skills.filter((skill) => skill.name !== body.name);
  } else if (method === 'skillUpload') {
    fx.uploads.push(payload);
    fx.skills = [...fx.skills, { ...skillsOf()[0]!, name: 'uploaded', on: false }];
  }
  const list = { persona: 'ben', skills: fx.skills, missing: fx.missing, selectedTokens: fx.skills.filter((skill) => skill.on).reduce((sum, skill) => sum + skill.tokens, 0), tokenizer: TOKENIZER };
  return method === 'skillUpload' ? { ok: true, name: 'uploaded', origin: 'own', files: 1, replaced: false, list } : { ok: true, list };
}

const TOKENIZER = { id: 'claude-estimate', family: 'anthropic', exact: false, model: null } as const;

/** The brief the engine would assemble: 2,490 tokens at the start, the instructions' share counted from the saved prompt. */
function previewReply(payload: unknown): unknown {
  if (fx.previewFail) {
    return { ok: false, code: 'no_persona', error: 'no persona' };
  }
  const instructions = 'error' in fx.prompt ? 0 : estimateTokens(fx.prompt.text.trim(), TOKENIZER);
  const asked = payload as { step?: string };
  return {
    ok: true,
    persona: 'ben',
    step: asked.step ?? 'build',
    text: 'The whole brief',
    tokens: 2490,
    tokenizer: TOKENIZER,
    parts: [
      { name: 'instructions', tokens: instructions },
      { name: 'skills', tokens: 550 },
      { name: 'memory', tokens: 90 },
      { name: 'rest', tokens: 2490 - instructions - 550 - 90 },
    ],
    skills: fx.skills.filter((skill) => skill.on).map((skill) => ({ name: skill.name, tokens: skill.tokens })),
  };
}

function depsOf(): DeskDeps {
  return {
    api: {
      i18n,
      commands: { run: (id: string, payload?: unknown) => fx.commands.push([id, payload]) },
      vault: {
        readFile: async () => {
          if ('error' in fx.prompt) {
            throw fx.prompt.error;
          }
          return { content: fx.prompt.text, modifiedMs: 1 };
        },
        listVaults: async () => [
          { id: 'v1', name: 'tickets' },
          { id: 'notes', name: 'notes' },
        ],
      },
      ui: { icon: () => document.createElementNS('http://www.w3.org/2000/svg', 'svg'), showDiff: fx.showDiff, createMarkdownView: fakeView, showModal: fakeModal },
    } as unknown as DeskDeps['api'],
    snapshot: () => ({ vaultId: 'v1', pipeline: [{ id: 'plan', title: 'Plan', handover: 'agent plan-default' }, { id: 'build', title: 'Build', handover: 'agent build-default' }] }) as unknown as BoardSnapshot,
    runs: () => fx.runs,
    chain: () => null,
    invoke: async (method, payload) => {
      fx.invoked.push([method, payload]);
      switch (method) {
        case 'personaImprovements':
          if (fx.failLoads > 0) {
            fx.failLoads -= 1;
            throw new TypeError('fetch failed');
          }
          return { ok: true, persona: { skills: ['tdd'] }, proposals: fx.proposals, openCount: fx.proposals.length, frictionCount: 0 };
        case 'poolModels':
          return fx.table;
        case 'slots':
          return SLOTS;
        case 'personaMemory':
          return fx.replies['personaMemory'] ?? { ok: true, entries: [1, 2, 3] };
        case 'personaJournal':
          return fx.replies['personaJournal'] ?? { ok: true, entries: [1, 2] };
        case 'personaSkills':
        case 'personaSkillToggle':
        case 'personaSkillRemove':
        case 'skillUpload':
          return skillReply(method, payload);
        case 'personaPromptPreview':
          return previewReply(payload);
        default:
          return fx.replies[method] ?? { ok: true };
      }
    },
    subscribe: () => () => undefined,
    mutate: async (_label, run) => {
      await run();
      return { ok: true } as never;
    },
    chainAction: async () => undefined,
    openTicket: () => undefined,
    newIdea: () => undefined,
    titleOf: () => null,
  };
}

function storeOf(): TeamStore {
  return { personas: () => [{ ...view, ...fx.view }], nameOf: () => 'Ben', loaded: () => true, error: () => '', refresh: async () => void (fx.refreshes += 1), subscribe: () => () => undefined };
}

export async function settle(): Promise<void> {
  for (let i = 0; i < 8; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

export async function mount(seams: PersonaPageSeams = {}): Promise<void> {
  const pageHost: PersonaPageHost = { back: () => (fx.backs += 1), retitle: (title) => fx.retitled.push(title), removed: () => (fx.removed += 1) };
  fx.dispose = mountPersonaPage(depsOf(), storeOf(), fx.host, 'ben', pageHost, seams);
  await settle();
}

export const q = <T extends HTMLElement>(selector: string): T => {
  const node = fx.host.querySelector<T>(selector);
  if (node === null) {
    throw new Error(`no ${selector}`);
  }
  return node;
};

export const buttonOf = (name: string): HTMLButtonElement => {
  const button = [...fx.host.querySelectorAll('button')].find((entry) => entry.textContent === name || entry.getAttribute('aria-label') === name);
  if (button === undefined) {
    throw new Error(`no button ${name}`);
  }
  return button;
};

export const type = (node: HTMLInputElement, text: string): void => {
  node.value = text;
  node.dispatchEvent(new Event('input'));
};

export const choose = (node: HTMLSelectElement, value: string): void => {
  node.value = value;
  node.dispatchEvent(new Event('change'));
};

export const stateText = (): string => q('.persona-state').textContent ?? '';
export const patches = (): Record<string, unknown>[] => fx.invoked.filter(([method]) => method === 'personaPatch').map(([, payload]) => payload as Record<string, unknown>);
export const editor = (): FakeView => fx.views.find((entry) => !entry.disposed && entry.opts.mode === 'live')!;
export const typeInEditor = (text: string): void => editor().opts.onChange?.(text);
