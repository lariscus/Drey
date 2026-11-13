// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buttonOf, choose, cleanFixture, editor, fx, mount, patches, q, resetFixture, settle, stateText, type, typeInEditor } from './persona-page.harness';
import { personaWordCountOf } from './persona-page';

beforeEach(resetFixture);
afterEach(cleanFixture);

describe('the Persona page v2 (R11, board 7k)', () => {
  it('draws every block of the mockup from the record and what lies beside it', async () => {
    await mount();
    expect(q('.persona-head-name').textContent).toBe('Ben');
    expect(q('.persona-head-names').textContent).toBe('BenBuilder');
    expect(q<HTMLInputElement>('[data-field="title"]').value).toBe('Ben');
    expect(q<HTMLSelectElement>('[data-field="role"]').value).toBe('Builder');
    expect(q<HTMLInputElement>('[data-field="summary"]').value).toBe('Builds one part of a ticket, test first.');
    expect(fx.host.querySelector('.persona-step')).toBeNull(); // req-258: the persona board has no steps
    expect(q<HTMLSelectElement>('[data-field="min-class"]').value).toBe('standard');
    expect(q('[data-field="readonly"]').getAttribute('aria-checked')).toBe('false');
    expect(q<HTMLInputElement>('[data-field="parallel"]').value).toBe('2');
    expect(q<HTMLInputElement>('[data-field="min"]').value).toBe('0');
    expect([...fx.host.querySelectorAll('.persona-action')].map((node) => node.textContent)).toEqual(['sync-main']);
    expect(q<HTMLSelectElement>('[data-field="worker"]').value).toBe('claude-code');
    expect([...fx.host.querySelectorAll('.persona-pool-row')].map((node) => [node.querySelector('.persona-pool-n')?.textContent, node.querySelector('.persona-pool-name')?.textContent, node.querySelector('.persona-tag')?.textContent])).toEqual([
      ['1', 'opusClaude Code · class heavy · factor 3', '0 / 3 busy'],
      ['2', 'sonnetClaude Code · class standard · factor 1', '0 / 3 busy'],
    ]);
    expect(q<HTMLInputElement>('[data-field="budget"]').value).toBe('$5');
    expect([...fx.host.querySelectorAll('.persona-allow-row')].map((row) => row.firstElementChild?.textContent)).toEqual(['Read vaults', 'Write vaults', 'Run commands in the worktree', 'Reach the network', 'Spend above the ticket allowance']);
    expect(q('.persona-vault-pick > button').textContent).toBe('notes▾');
    expect(q('.persona-skill').textContent).toContain('personas/ben/skills/tdd/SKILL.md');
    expect(q('.persona-skill').textContent).toContain('own · 240 tokens');
    expect(q('[data-proposal]').textContent).toContain('Add a line');
    expect(q('.persona-links').textContent).toBe('Memory · 3 →Journal · 2 →Talk to Ben 1:1 →');
    expect(stateText()).toBe('Saved');
    expect(fx.retitled).toEqual(['Ben']);
    expect(personaWordCountOf('ben')).toBe(5);
  });

  it('mounts the host editor in the Instructions block over prompt.md: Live Preview, no Markdown button', async () => {
    await mount();
    expect(editor().text).toBe('## Who Ben is\n\nCalm.');
    expect(editor().readOnly).toBe(false);
    expect(fx.host.querySelector('.persona-block .fake-editor')).not.toBeNull();
    expect([...fx.host.querySelectorAll('button')].some((button) => /Markdown/.test(button.textContent ?? ''))).toBe(false);
    expect(q('.persona-tokens').textContent).toBe('≈ 2,490 tokens at start');
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
    const selects = [...fx.host.querySelectorAll<HTMLSelectElement>('.persona-allow-row select')];
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
    expect(fx.retitled.at(-1)).toBe('Benno');
    expect(q('.persona-head-name').textContent).toBe('Benno');
  });

  it('the write-vaults choice is the vault ids, per vault', async () => {
    await mount();
    q('.persona-vault-pick > button').click();
    const boxes = [...fx.host.querySelectorAll<HTMLInputElement>('.persona-vault-item input')];
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

  it('req-258: the run settings save as one settings patch of what changed', async () => {
    await mount();
    choose(q<HTMLSelectElement>('[data-field="min-class"]'), 'heavy');
    q('[data-field="readonly"]').click();
    expect(q('[data-field="readonly"]').getAttribute('aria-checked')).toBe('true');
    type(q<HTMLInputElement>('[data-field="parallel"]'), '');
    type(q<HTMLInputElement>('[data-field="min"]'), '1');
    q('[data-action="sync-main"] button').click();
    expect(fx.host.querySelector('.persona-action')).toBeNull();
    buttonOf('Add action…').click();
    choose(q<HTMLSelectElement>('.persona-actions select'), 'commit');
    expect([...fx.host.querySelectorAll('.persona-action')].map((node) => node.textContent)).toEqual(['commit']);
    buttonOf('Save').click();
    await settle();
    expect(patches()).toEqual([{ persona: 'ben', settings: { minClass: 'heavy', readOnly: true, parallel: null, min: 1, leaving: ['commit'] } }]);
  });

  it('the models come from the table; a row moves, goes, and a new one is picked from the table', async () => {
    await mount();
    q<HTMLElement>('[data-model="opus"] .persona-icon-btn').click();
    [...q('[data-model="opus"]').querySelectorAll('button')].find((button) => button.textContent === 'Move down')!.click();
    expect([...fx.host.querySelectorAll('.persona-pool-row')].map((row) => (row as HTMLElement).dataset['model'])).toEqual(['sonnet', 'opus']);
    buttonOf('Add a model…').click();
    choose(q<HTMLSelectElement>('.persona-add select'), 'haiku');
    expect([...fx.host.querySelectorAll('.persona-pool-row')].map((row) => (row as HTMLElement).dataset['model'])).toEqual(['sonnet', 'opus', 'haiku']);
    buttonOf('Save').click();
    await settle();
    expect(patches()).toEqual([{ persona: 'ben', pool: ['sonnet', 'opus', 'haiku'] }]);
  });

  it('without a model table the model name is typed, and an unlisted model says so', async () => {
    fx.table = null;
    await mount();
    expect(q('[data-model="opus"]').textContent).toContain('not in the model table');
    buttonOf('Add a model…').click();
    const input = q<HTMLInputElement>('.persona-add input');
    type(input, 'glm-5.3');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(fx.host.querySelector('[data-model="glm-5.3"]')).not.toBeNull();
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

  it('req-269 (v4): Mission Control\'s persona has no work, rights, proposals or Delete; her model and skills are covered in persona-page-tabs.spec.ts', async () => {
    fx.view = { kind: 'mission', role: 'custom', worker: '', model: '', pool: [], phases: [], budget: null };
    fx.prompt = { text: '## Who Pia is\n\nMission Control.' };
    await mount();
    expect(q<HTMLInputElement>('[data-field="title"]').value).toBe('Ben');
    expect(editor().text).toBe('## Who Pia is\n\nMission Control.');
    for (const selector of ['[data-field="worker"]', '[data-field="min-class"]', '[data-field="budget"]', '.persona-allow-row', '[data-proposal]', '.persona-delete-open']) {
      expect(fx.host.querySelector(selector), selector).toBeNull();
    }
    // req-296 / req-293: her skills ride her prompt, so the page counts it and previews it like any persona's.
    expect([...fx.host.querySelectorAll('button')].some((entry) => entry.textContent === 'Preview full prompt')).toBe(true);
    typeInEditor('## Who Pia is\n\nShorter answers.');
    buttonOf('Save').click();
    await settle();
    expect(patches()).toEqual([{ persona: 'ben', prompt: '## Who Pia is\n\nShorter answers.' }]);
  });

  it('draws no explanatory prose: titles, labels and controls only', async () => {
    await mount();
    const text = fx.host.textContent ?? '';
    for (const sentence of ['Plain Markdown', 'One commit to', 'Also loaded at session start', 'The steps of your flows', 'All registered vaults', 'Otherwise the run waits']) {
      expect(text, sentence).not.toContain(sentence);
    }
    expect(fx.host.querySelector('[title="Otherwise the run waits for you."]')).not.toBeNull();
  });

  it('draws nothing the engine does not serve yet: no portrait upload, no notify rule', async () => {
    await mount();
    const text = fx.host.textContent ?? '';
    for (const absent of ['Upload picture', 'Tell me when']) {
      expect(text, absent).not.toContain(absent);
    }
  });
});
