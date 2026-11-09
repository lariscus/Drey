// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- the spec stands in for the host, which owns the catalog at runtime
import { i18n } from '../../../../shared/i18n';
import type { MarkdownViewHandle, MarkdownViewOptions } from '../../../../shared/plugin-api/renderer';
import type { PersonaView } from '../../shared/remote-protocol';
import type { BoardSnapshot } from '../../shared/tickets';
import type { DeskDeps } from '../desk-deps';
import { mountPersonaPage, personaWordCountOf, type PersonaPageHost, type PersonaPageSeams } from './persona-page';
import type { TeamStore } from './team-store';

const view: PersonaView = {
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
  allowed: { spendAboveAllowance: false, writeVaults: ['notes'] },
};

const OPEN_PROPOSAL = { id: 'imp-1', state: 'open', target: 'prompt.md', title: 'Add a line', evidence: ['a', 'b', 'c'], content: 'Suggested prompt', lesson: null, at: '', decidedAt: null };

const TABLE = {
  ok: true,
  models: [
    { model: 'opus', slot: null, provider: 'claude-code', category: 'frontier', class: 'A', cost: 3, sessions: 2 },
    { model: 'sonnet', slot: null, provider: 'claude-code', category: 'everyday', class: 'B', cost: 1, sessions: 3 },
    { model: 'haiku', slot: null, provider: 'claude-code', category: 'bulk', class: 'C', cost: 0.2, sessions: 3 },
  ],
};
const SLOTS = { ok: true, slots: [{ id: 'claude-a', label: 'Claude A', provider: 'claude-code', busy: 1, total: 3 }] };

interface FakeView {
  readonly handle: MarkdownViewHandle;
  readonly opts: MarkdownViewOptions;
  text: string;
  readOnly: boolean;
  mode: string;
  formats: string[];
  disposed: boolean;
}

let invoked: [string, unknown][];
let prompt: { text: string } | { error: Error };
let proposals: unknown[];
let replies: Record<string, unknown>;
let table: unknown;
let views: FakeView[];
let showDiff: ReturnType<typeof vi.fn>;
let retitled: string[];
let crew: [string, string][];
let backs: number;
let host: HTMLElement;
let dispose: (() => void) | null;
let failLoads: number;

function fakeView(opts: MarkdownViewOptions): MarkdownViewHandle {
  const fake: FakeView = { opts, text: opts.content ?? '', readOnly: opts.readOnly === true, mode: opts.mode ?? 'live', formats: [], disposed: false, handle: null as never };
  const element = document.createElement('div');
  element.className = 'fake-editor';
  const handle: MarkdownViewHandle = {
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
  (fake as { handle: MarkdownViewHandle }).handle = handle;
  views.push(fake);
  return handle;
}

function depsOf(): DeskDeps {
  return {
    api: {
      i18n,
      vault: {
        readFile: async () => {
          if ('error' in prompt) {
            throw prompt.error;
          }
          return { content: prompt.text, modifiedMs: 1 };
        },
        listVaults: async () => [{ id: 'v1', name: 'tickets' }, { id: 'notes', name: 'notes' }],
      },
      ui: { icon: () => document.createElementNS('http://www.w3.org/2000/svg', 'svg'), showDiff, createMarkdownView: fakeView },
    } as unknown as DeskDeps['api'],
    snapshot: () => ({ vaultId: 'v1', pipeline: [{ id: 'plan', title: 'Plan', handover: 'agent plan-default' }, { id: 'build', title: 'Build', handover: 'agent build-default' }] }) as unknown as BoardSnapshot,
    runs: () => [],
    chain: () => null,
    invoke: async (method, payload) => {
      invoked.push([method, payload]);
      switch (method) {
        case 'personaImprovements':
          if (failLoads > 0) {
            failLoads -= 1;
            throw new TypeError('fetch failed');
          }
          return { ok: true, persona: { skills: ['tdd'] }, proposals, openCount: proposals.length, frictionCount: 0 };
        case 'poolModels':
          return table;
        case 'slots':
          return SLOTS;
        case 'personaMemory':
          return { ok: true, entries: [1, 2, 3] };
        case 'personaJournal':
          return { ok: true, entries: [1, 2] };
        default:
          return replies[method] ?? { ok: true };
      }
    },
    subscribe: () => () => undefined,
    mutate: async () => ({ ok: true }) as never,
    chainAction: async () => undefined,
    openTicket: () => undefined,
    newIdea: () => undefined,
    titleOf: () => null,
  };
}

function storeOf(): TeamStore {
  return { personas: () => [view], nameOf: () => 'Ben', loaded: () => true, error: () => '', refresh: async () => undefined, subscribe: () => () => undefined };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 8; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function mount(seams: PersonaPageSeams = {}): Promise<void> {
  const pageHost: PersonaPageHost = { back: () => (backs += 1), retitle: (title) => retitled.push(title), openCrew: (persona, tab) => crew.push([persona, tab]) };
  dispose = mountPersonaPage(depsOf(), storeOf(), host, 'ben', pageHost, { skills: { list: async (_id, names) => names.filter((n) => n === 'tdd').map((name) => ({ name, path: 'skills/tdd/SKILL.md', origin: 'own' as const, tokens: 240 })) }, ...seams });
  await settle();
}

const q = <T extends HTMLElement>(selector: string): T => {
  const node = host.querySelector<T>(selector);
  if (node === null) {
    throw new Error(`no ${selector}`);
  }
  return node;
};
const buttonOf = (name: string): HTMLButtonElement => {
  const button = [...host.querySelectorAll('button')].find((entry) => entry.textContent === name || entry.getAttribute('aria-label') === name);
  if (button === undefined) {
    throw new Error(`no button ${name}`);
  }
  return button;
};
const type = (node: HTMLInputElement, text: string): void => {
  node.value = text;
  node.dispatchEvent(new Event('input'));
};
const choose = (node: HTMLSelectElement, value: string): void => {
  node.value = value;
  node.dispatchEvent(new Event('change'));
};
const stateText = (): string => q('.persona-state').textContent ?? '';
const patches = (): Record<string, unknown>[] => invoked.filter(([method]) => method === 'personaPatch').map(([, payload]) => payload as Record<string, unknown>);
const editor = (): FakeView => views.find((entry) => !entry.disposed && entry.opts.mode === 'live')!;
const typeInEditor = (text: string): void => editor().opts.onChange?.(text);

beforeEach(() => {
  invoked = [];
  prompt = { text: '## Who Ben is\n\nCalm.' };
  proposals = [OPEN_PROPOSAL];
  replies = {};
  table = TABLE;
  views = [];
  showDiff = vi.fn(async () => undefined);
  retitled = [];
  crew = [];
  backs = 0;
  host = document.createElement('div');
  document.body.append(host);
  dispose = null;
  failLoads = 0;
});

afterEach(() => {
  // A test leaves no draft behind for the next: Discard clears the page's memory of it.
  [...host.querySelectorAll('button')].find((entry) => entry.textContent === 'Discard')?.click();
  dispose?.();
  host.remove();
});

describe('the Persona page v2 (R11, board 7k)', () => {
  it('draws every block of the mockup from the record and what lies beside it', async () => {
    await mount();
    expect(q('.persona-head-name').textContent).toBe('Ben');
    expect(q('.persona-head').textContent).toContain('Builder · personas/ben/ · Memory 3 · Journal 2 · Proposals 1');
    expect(q<HTMLInputElement>('[data-field="title"]').value).toBe('Ben');
    expect(q<HTMLSelectElement>('[data-field="role"]').value).toBe('Builder');
    expect(q<HTMLInputElement>('[data-field="summary"]').value).toBe('Builds one part of a ticket, test first.');
    expect([...host.querySelectorAll('.persona-step')].map((node) => node.textContent)).toEqual(['Plan', '✓ Build']);
    expect(q<HTMLSelectElement>('[data-field="worker"]').value).toBe('claude-code');
    expect([...host.querySelectorAll('.persona-pool-row')].map((node) => [node.querySelector('.persona-pool-n')?.textContent, node.querySelector('.persona-pool-name')?.textContent, node.querySelector('.persona-tag')?.textContent])).toEqual([
      ['1', 'opusClaude Code · class A · factor 3', '1 / 3 busy'],
      ['2', 'sonnetClaude Code · class B · factor 1', '1 / 3 busy'],
    ]);
    expect(q<HTMLInputElement>('[data-field="budget"]').value).toBe('$5');
    expect([...host.querySelectorAll('.persona-allow-row')].map((row) => row.firstElementChild?.textContent)).toEqual(['Read vaults', 'Write vaults', 'Run commands in the worktree', 'Reach the network', 'Spend above the ticket allowance']);
    expect(q('.persona-vault-pick > button').textContent).toBe('notes▾');
    expect(q('.persona-skill').textContent).toContain('skills/tdd/SKILL.md');
    expect(q('.persona-skill').textContent).toContain('own · 240 tokens');
    expect(q('[data-proposal]').textContent).toContain('Add a line');
    expect(q('.persona-links').textContent).toBe('Memory · 3 →Journal · 2 →Talk to Ben 1:1 →');
    expect(stateText()).toBe('Saved');
    expect(retitled).toEqual(['Ben']);
    expect(personaWordCountOf('ben')).toBe(5);
  });

  it('mounts the host editor in the Instructions block over prompt.md: Live Preview, no Markdown button', async () => {
    await mount();
    expect(editor().text).toBe('## Who Ben is\n\nCalm.');
    expect(editor().readOnly).toBe(false);
    expect(host.querySelector('.persona-block .fake-editor')).not.toBeNull();
    expect([...host.querySelectorAll('button')].some((button) => /Markdown/.test(button.textContent ?? ''))).toBe(false);
    expect(q('.persona-tokens').textContent).toBe('≈ 5 tokens');
  });

  it('the strip applies the host formatting and the mode switch flips Live and Source', async () => {
    await mount();
    buttonOf('Bold').click();
    buttonOf('Task list').click();
    expect(editor().formats).toEqual(['bold', 'task']);
    buttonOf('Source').click();
    expect(editor().mode).toBe('source');
    expect(buttonOf('Source').getAttribute('aria-pressed')).toBe('true');
    buttonOf('Live').click();
    expect(editor().mode).toBe('live');
  });

  it('Save is one patch with every changed key, one commit on the engine side', async () => {
    await mount();
    type(q('[data-field="title"]'), 'Benno');
    type(q('[data-field="summary"]'), 'Builds one part.');
    choose(q('[data-field="role"]'), 'Reviewer');
    choose(q('[data-field="worker"]'), 'opencode');
    type(q('[data-field="budget"]'), '$7.50');
    typeInEditor('New instructions');
    const selects = [...host.querySelectorAll<HTMLSelectElement>('.persona-allow-row select')];
    choose(selects[0]!, 'bypass');
    choose(selects[1]!, 'on');
    choose(selects[2]!, 'allow');
    expect(stateText()).toBe('Changed · not saved');
    buttonOf('Save').click();
    await settle();
    expect(patches()).toEqual([
      {
        persona: 'ben',
        title: 'Benno',
        role: 'reviewer',
        summary: 'Builds one part.',
        worker: 'opencode',
        budget: 7.5,
        prompt: 'New instructions',
        allowed: { runCommands: 'bypass', network: true, spendAboveAllowance: true },
      },
    ]);
    expect(stateText()).toBe('Saved');
    expect(retitled.at(-1)).toBe('Benno');
  });

  it('the write-vaults choice is the vault ids, per vault', async () => {
    await mount();
    q('.persona-vault-pick > button').click();
    const boxes = [...host.querySelectorAll<HTMLInputElement>('.persona-vault-item input')];
    expect(boxes.map((box) => [box.dataset['vault'], box.checked])).toEqual([['v1', false], ['notes', true]]);
    boxes[0]!.checked = true;
    boxes[0]!.dispatchEvent(new Event('change'));
    boxes[1]!.checked = false;
    boxes[1]!.dispatchEvent(new Event('change'));
    expect(q('.persona-vault-pick > button').textContent).toBe('tickets▾');
    buttonOf('Save').click();
    await settle();
    expect(patches()).toEqual([{ persona: 'ben', allowed: { writeVaults: ['v1'] } }]);
  });

  it('a skill switch edits the skills list; a switched-off row stays until it is saved', async () => {
    await mount();
    const toggle = q<HTMLButtonElement>('[data-skill="tdd"] .persona-switch');
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    toggle.click();
    expect(q('[data-skill="tdd"] .persona-switch').getAttribute('aria-checked')).toBe('false');
    expect(stateText()).toBe('Changed · not saved');
    buttonOf('Save').click();
    await settle();
    expect(patches()).toEqual([{ persona: 'ben', skills: [] }]);
  });

  it('the models come from the table; a row moves, goes, and a new one is picked from the table', async () => {
    await mount();
    q<HTMLElement>('[data-model="opus"] .persona-icon-btn').click();
    [...q('[data-model="opus"]').querySelectorAll('button')].find((button) => button.textContent === 'Move down')!.click();
    expect([...host.querySelectorAll('.persona-pool-row')].map((row) => (row as HTMLElement).dataset['model'])).toEqual(['sonnet', 'opus']);
    buttonOf('Add a model…').click();
    choose(q<HTMLSelectElement>('.persona-add select'), 'haiku');
    expect([...host.querySelectorAll('.persona-pool-row')].map((row) => (row as HTMLElement).dataset['model'])).toEqual(['sonnet', 'opus', 'haiku']);
    buttonOf('Save').click();
    await settle();
    expect(patches()).toEqual([{ persona: 'ben', pool: ['sonnet', 'opus', 'haiku'] }]);
  });

  it('without a model table the model name is typed, and an unlisted model says so', async () => {
    table = null;
    await mount();
    expect(q('[data-model="opus"]').textContent).toContain('not in the model table');
    buttonOf('Add a model…').click();
    const input = q<HTMLInputElement>('.persona-add input');
    type(input, 'glm-5.3');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(host.querySelector('[data-model="glm-5.3"]')).not.toBeNull();
  });

  it('Discard puts the form and the editor back as they were read', async () => {
    await mount();
    type(q('[data-field="title"]'), 'Benno');
    typeInEditor('Other');
    buttonOf('Discard').click();
    expect(q<HTMLInputElement>('[data-field="title"]').value).toBe('Ben');
    expect(editor().text).toBe('## Who Ben is\n\nCalm.');
    expect(stateText()).toBe('Saved');
    buttonOf('Save').click();
    await settle();
    expect(patches()).toEqual([]);
  });

  it('draws no explanatory prose: titles, labels and controls only', async () => {
    await mount();
    const text = host.textContent ?? '';
    for (const sentence of ['Plain Markdown', 'One commit to', 'Also loaded at session start', 'The steps of your flows', 'All registered vaults', 'Otherwise the run waits']) {
      expect(text, sentence).not.toContain(sentence);
    }
    expect(host.querySelector('[title="Otherwise the run waits for you."]')).not.toBeNull();
  });

  it('draws nothing the engine does not serve yet: no preview button, no upload, no notify rule', async () => {
    await mount();
    const text = host.textContent ?? '';
    for (const absent of ['Preview full prompt', 'Add skill', 'Upload picture', 'Tell me when', 'committed']) {
      expect(text, absent).not.toContain(absent);
    }
  });

  it('draws Preview full prompt once a seam assembles the prompt, and shows what it returns', async () => {
    await mount({ preview: { available: true, preview: async () => ({ text: 'The whole brief', tokens: 2490 }) } });
    buttonOf('Preview full prompt').click();
    await settle();
    expect(views.find((entry) => entry.mode === 'view')?.text).toBe('The whole brief');
    expect(q('.persona-ed-preview').textContent).toContain('≈ 2,490 tokens');
    buttonOf('Preview full prompt').click();
    expect(host.querySelector('.persona-ed-preview')).toBeNull();
  });

  it('a missing prompt.md is an empty prompt and stays writable; an unreadable one locks the editor and Save', async () => {
    prompt = { error: new Error("ENOENT: no such file or directory, open 'prompt.md'") };
    await mount();
    expect(editor().readOnly).toBe(false);
    expect(editor().text).toBe('');
    dispose?.();
    host.replaceChildren();
    views = [];
    prompt = { error: new Error('EISDIR: illegal operation on a directory') };
    await mount();
    expect(editor().readOnly).toBe(true);
    expect(buttonOf('Save').disabled).toBe(true);
    expect(stateText()).toBe('Could not read the instructions; nothing can be saved');
  });

  it('refuses to save over a prompt that changed on disk since it was read', async () => {
    await mount();
    typeInEditor('Mine');
    prompt = { text: 'Someone else wrote this' };
    buttonOf('Save').click();
    await settle();
    expect(patches()).toEqual([]);
    expect(stateText()).toBe('The instructions changed on disk. Discard to load them.');
  });

  it('Apply on a prompt proposal rewrites the editor from the file; Dismiss only closes the card', async () => {
    await mount();
    prompt = { text: 'Applied by the engine' };
    proposals = [];
    buttonOf('Apply').click();
    await settle();
    expect(invoked.find(([method]) => method === 'personaImprovementDecide')?.[1]).toEqual({ persona: 'ben', proposal: 'imp-1', decision: 'accepted' });
    expect(editor().text).toBe('Applied by the engine');
    expect(host.querySelector('[data-proposal]')).toBeNull();
    expect(stateText()).toBe('Saved');
  });

  it('Apply waits while the instructions hold unsaved text; Show diff compares with the proposal', async () => {
    await mount();
    buttonOf('Show diff').click();
    expect(showDiff).toHaveBeenCalledWith(expect.objectContaining({ before: '## Who Ben is\n\nCalm.', after: 'Suggested prompt' }));
    typeInEditor('Typed');
    await settle();
    expect(buttonOf('Apply').disabled).toBe(true);
  });

  it('Dismiss sends the decision and drops the card', async () => {
    await mount();
    proposals = [];
    buttonOf('Dismiss').click();
    await settle();
    expect(invoked.find(([method]) => method === 'personaImprovementDecide')?.[1]).toEqual({ persona: 'ben', proposal: 'imp-1', decision: 'dismissed' });
    expect(host.querySelector('[data-proposal]')).toBeNull();
  });

  it('the links open the Crew tab on that persona; Back goes to Crew', async () => {
    await mount();
    buttonOf('Memory · 3 →').click();
    buttonOf('Journal · 2 →').click();
    buttonOf('Talk to Ben 1:1 →').click();
    expect(crew).toEqual([['ben', 'Memory'], ['ben', 'Memory'], ['ben', '1:1']]);
    buttonOf('Back to Crew').click();
    expect(backs).toBe(1);
  });

  it('a load that fails shows why and tries again by itself: the engine may be restarting', async () => {
    failLoads = 1;
    const real = globalThis.setTimeout;
    const delays: number[] = [];
    const spy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((run: () => void, delay?: number) => {
      delays.push(delay ?? 0);
      return real(run, (delay ?? 0) > 0 ? 1 : 0);
    }) as typeof setTimeout);
    await mount();
    await settle();
    spy.mockRestore();
    expect(delays).toContain(2_000);
    expect(editor().text).toBe('## Who Ben is\n\nCalm.');
  });

  it('keeps the error on screen while the engine stays away, and stops trying once closed', async () => {
    failLoads = 1000;
    await mount();
    expect(q('.persona-note').textContent).toBe('fetch failed');
    expect(views).toEqual([]);
    const calls = invoked.length;
    dispose?.();
    dispose = null;
    await new Promise((resolve) => setTimeout(resolve, 2_100));
    expect(invoked.length).toBe(calls);
    failLoads = 0;
  });
});
