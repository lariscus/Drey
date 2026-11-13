// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buttonOf, choose, cleanFixture, fx, mount, patches, q, resetFixture, settle, stateText, type } from './persona-page.harness';

beforeEach(resetFixture);
afterEach(cleanFixture);

const PIA = { kind: 'mission' as const, title: 'Pia', role: 'custom', summary: 'Mission Control: the owner\'s one contact', worker: '', model: '', pool: [], phases: [], budget: null };
const CHAT_MODELS = { ok: true, provider: 'lmstudio', providerLabel: 'LM Studio', assistantModel: 'qwen3-coder-30b', models: ['qwen3-coder-30b', 'glm-4.7-flash'] };

const modelSelect = (): HTMLSelectElement => q<HTMLSelectElement>('[data-field="chat-model"]');
const optionValue = (label: string): string => [...modelSelect().options].find((option) => option.textContent === label)!.value;

describe('the head facts (board 7k v4, req-295)', () => {
  it('says the state and today\'s cost after the name and role, with Pause as an icon button', async () => {
    fx.view = { dailyCost: 2.67 };
    await mount();
    expect(q('.persona-facts').textContent).toBe('idle · $2.67 today');
    const pause = q<HTMLButtonElement>('.persona-pause');
    expect(pause.title).toBe('Pause Ben');
    expect(pause.getAttribute('aria-label')).toBe('Pause Ben');
    expect(pause.textContent).toBe('');
    pause.click();
    await settle();
    expect(fx.invoked).toContainEqual(['personaPause', { persona: 'ben', paused: true }]);
    expect(fx.refreshes).toBeGreaterThan(0);
  });

  it('omits the cost where none is known and reads Resume while paused', async () => {
    fx.view = { paused: true };
    await mount();
    expect(q('.persona-facts').textContent).toBe('paused');
    expect(q('.persona-pause').getAttribute('aria-label')).toBe('Resume Ben');
    q<HTMLButtonElement>('.persona-pause').click();
    await settle();
    expect(fx.invoked).toContainEqual(['personaPause', { persona: 'ben', paused: false }]);
  });
});

describe('the right column\'s tabs', () => {
  it('draws Instructions · Memory · count · 1:1 and starts on Instructions', async () => {
    await mount();
    expect([...fx.host.querySelectorAll('.persona-tab')].map((tab) => tab.textContent)).toEqual(['Instructions', 'Memory · 3', '1:1']);
    expect(q('.persona-tab-on').textContent).toBe('Instructions');
    expect(fx.host.querySelector('.persona-right .persona-ed')).not.toBeNull();
    expect(q('.persona-tabrow').textContent).toContain('tokens at start');
    expect(q('.persona-tabrow').textContent).toContain('Preview full prompt');
  });

  it('Memory and 1:1 mount the Crew detail\'s panes in the page; the choice survives a repaint', async () => {
    await mount();
    const before = fx.invoked.length;
    buttonOf('Memory · 3').click();
    await settle();
    expect(q('.persona-pane').dataset['pane']).toBe('memory');
    expect(fx.host.querySelector('.persona-right .persona-ed')).toBeNull();
    expect(fx.invoked.slice(before).map(([method]) => method)).toContain('personaMemory');
    buttonOf('1:1').click();
    await settle();
    expect(q('.persona-pane').dataset['pane']).toBe('talk');
    expect(fx.invoked.map(([method]) => method)).toContain('personaThread');
    buttonOf('Discard').click();
    await settle();
    expect(q('.persona-tab-on').textContent).toBe('1:1');
    expect(fx.host.querySelector('.persona-foot, .persona-save')).not.toBeNull();
    buttonOf('Instructions').click();
    expect(fx.host.querySelector('.persona-right .persona-ed')).not.toBeNull();
  });

  it('a plain Memory tab when there are no entries', async () => {
    fx.replies['personaMemory'] = { ok: true, entries: [] };
    fx.replies['personaJournal'] = { ok: true, entries: [] };
    await mount();
    expect(q('[data-tab="memory"]').textContent).toBe('Memory');
  });
});

describe('Mission Control\'s persona (board 7k v4 `DeskPersonaPia`)', () => {
  beforeEach(() => {
    fx.view = PIA;
    fx.replies['chatModels'] = CHAT_MODELS;
  });

  it('heads her with Mission Control and the idle state: no cost, no Pause', async () => {
    fx.view = { ...PIA, dailyCost: 4 };
    await mount();
    expect(q('.persona-head-names').textContent).toBe('PiaMission Control');
    expect(q('.persona-facts').textContent).toBe('idle');
    expect(fx.host.querySelector('.persona-pause')).toBeNull();
  });

  it('has Profile without a Role field, then Model, then Skills in the left column; no Work, Allowed to, Proposals or Remove', async () => {
    await mount();
    const left = q('.persona-left');
    expect(left.querySelector('[data-field="title"]')).not.toBeNull();
    expect(left.querySelector('[data-field="summary"]')).not.toBeNull();
    expect(left.querySelector('[data-field="role"]')).toBeNull();
    expect([...left.querySelectorAll('.persona-block-head .persona-title')].map((node) => node.textContent)).toEqual(['Profile', 'Model', 'Skills']);
    expect(left.querySelector('.persona-skill-list')).not.toBeNull();
    expect(fx.host.querySelector('[data-field="parallel"]')).toBeNull();
    expect(fx.host.querySelector('.persona-allow-row')).toBeNull();
    expect(fx.host.querySelector('[data-proposal], .persona-links')).toBeNull();
    expect([...fx.host.querySelectorAll('button')].some((button) => button.textContent === 'Remove persona' || button.getAttribute('aria-label') === 'Remove persona')).toBe(false);
    expect([...fx.host.querySelectorAll('.persona-tab')].map((tab) => tab.textContent)).toEqual(['Instructions', 'Memory · 3', '1:1']);
    expect(q('.persona-tabrow').textContent).toContain('Preview full prompt');
  });

  it('shows the assistant\'s provider read-only with a link to Settings → LLM', async () => {
    await mount();
    expect(q('[data-field="provider"]').textContent).toContain('LM Studio');
    buttonOf('Settings → LLM').click();
    expect(fx.commands).toEqual([['settings.open', { category: 'llm' }]]);
  });

  it('offers Same as the assistant first (its id beside it), then the endpoint\'s models, then Other model…', async () => {
    await mount();
    expect([...modelSelect().options].map((option) => option.textContent)).toEqual(['Same as the assistant', 'qwen3-coder-30b', 'glm-4.7-flash', 'Other model…']);
    expect(modelSelect().value).toBe('');
    expect(q('.persona-model-assistant').textContent).toBe('qwen3-coder-30b');
    expect(q<HTMLElement>('.persona-model-assistant').hidden).toBe(false);
  });

  it('a listed model is saved as chatModel; back to Same as the assistant is not a change, and after a change it sends null', async () => {
    await mount();
    choose(modelSelect(), 'glm-4.7-flash');
    expect(stateText()).toBe('Changed · not saved');
    expect(q<HTMLElement>('.persona-model-assistant').hidden).toBe(true);
    choose(modelSelect(), '');
    expect(stateText()).toBe('Saved');
    choose(modelSelect(), 'glm-4.7-flash');
    buttonOf('Save').click();
    await settle();
    expect(patches()).toEqual([{ persona: 'ben', chatModel: 'glm-4.7-flash' }]);
    choose(modelSelect(), '');
    buttonOf('Save').click();
    await settle();
    expect(patches()[1]).toEqual({ persona: 'ben', chatModel: null });
  });

  it('Other model… takes a typed id: the patch carries it', async () => {
    await mount();
    expect(q<HTMLInputElement>('[data-field="chat-model-other"]').hidden).toBe(true);
    choose(modelSelect(), optionValue('Other model…'));
    const other = q<HTMLInputElement>('[data-field="chat-model-other"]');
    expect(other.hidden).toBe(false);
    type(other, ' my-local-model ');
    buttonOf('Save').click();
    await settle();
    expect(patches()).toEqual([{ persona: 'ben', chatModel: 'my-local-model' }]);
  });

  it('a stored id the endpoint does not list shows as Other with the id typed in', async () => {
    fx.view = { ...PIA, chatModel: 'custom-x' };
    await mount();
    expect(modelSelect().selectedOptions[0]?.textContent).toBe('Other model…');
    expect(q<HTMLInputElement>('[data-field="chat-model-other"]').value).toBe('custom-x');
    expect(stateText()).toBe('Saved');
  });

  it('keeps Same as the assistant and Other model… when the endpoint cannot be asked, and says why quietly', async () => {
    fx.replies['chatModels'] = { ok: false, error: 'connection refused' };
    await mount();
    expect([...modelSelect().options].map((option) => option.textContent)).toEqual(['Same as the assistant', 'Other model…']);
    expect(fx.host.querySelector('[data-field="provider"]')).toBeNull();
    expect(q('.persona-model-problem').textContent).toBe('Could not list the models: connection refused');
  });
});
