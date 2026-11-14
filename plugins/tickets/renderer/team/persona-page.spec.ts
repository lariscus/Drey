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
    expect(fx.host.querySelector('[data-field="min-class"]')).toBeNull(); // req-288: the floor folded into the class
    expect(q('[data-field="readonly"]').getAttribute('aria-checked')).toBe('false');
    expect(q<HTMLInputElement>('[data-field="parallel"]').value).toBe('2');
    expect(q<HTMLInputElement>('[data-field="min"]').value).toBe('0');
    expect([...fx.host.querySelectorAll('.persona-action')].map((node) => node.textContent)).toEqual(['sync-main']);
    // req-288: the Model block — the owner's classes, Next free in class, the counts; no harness, no pool
    expect(fx.host.querySelector('[data-field="worker"]')).toBeNull();
    expect(fx.host.querySelector('.persona-pool-row')).toBeNull();
    expect([...fx.host.querySelectorAll('.persona-seg-btn')].map((node) => [node.textContent, node.getAttribute('aria-checked')])).toEqual([['heavy', 'true'], ['standard', 'false'], ['light', 'false']]);
    expect(q('[data-field="pinned-model"]').textContent).toBe('Next free in class');
    expect(q('.persona-model-counts').textContent).toBe('1 heavy model · 1 free now');
    expect(q<HTMLInputElement>('[data-field="budget"]').value).toBe('$5');
    expect([...fx.host.querySelectorAll('.persona-allow-row')].map((row) => row.firstElementChild?.textContent)).toEqual(['Run commands', 'Reach the network', 'Change notes where the project allows', 'Spend above allowance']);
    expect(q('[data-field="write-notes"]').getAttribute('aria-checked')).toBe('true');
    expect(buttonOf('Vaults are set per project')).toBeDefined();
    expect(q('.persona-skill').textContent).toContain('own · tdd');
    expect(q('.persona-skill').textContent).toContain('240 tokens');
    expect(q('.persona-left').contains(q('[data-proposal]'))).toBe(true); // board 7k v3: Skills and Proposals in the left column
    expect(q('.persona-right').querySelectorAll('.persona-block').length).toBe(1); // the Instructions editor alone fills the right
    expect(q('[data-proposal]').textContent).toContain('Add a line');
    expect(fx.host.querySelector('.persona-links')).toBeNull(); // board 7k v3: Memory and the 1:1 are the page's tabs
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
    q<HTMLButtonElement>('.persona-seg-btn[data-value="standard"]').click();
    type(q('[data-field="budget"]'), '$7.50');
    typeInEditor('New instructions');
    q('[data-field="write-notes"]').click();
    choose(q<HTMLSelectElement>('.persona-allow-row select'), 'bypass');
    q('[data-field="network"]').click();
    q('[data-field="spend"]').click();
    expect(stateText()).toBe('Changed · not saved');
    buttonOf('Save').click();
    await settle();
    expect(patches()).toEqual([
      {
        persona: 'ben',
        title: 'Benno',
        role: 'reviewer',
        summary: 'Builds one part.',
        class: 'standard',
        budget: 7.5,
        prompt: 'New instructions',
        allowed: { writeNotes: false, runCommands: 'bypass', network: true, spendAboveAllowance: true },
      },
    ]);
    expect(stateText()).toBe('Saved');
    expect(fx.retitled.at(-1)).toBe('Benno');
    expect(q('.persona-head-name').textContent).toBe('Benno');
  });

  it('req-283: Change notes where the project allows saves write-notes — the vaults are the project\'s', async () => {
    await mount();
    expect(fx.host.querySelector('.persona-vault-pick')).toBeNull();
    q('[data-field="write-notes"]').click();
    expect(q('[data-field="write-notes"]').getAttribute('aria-checked')).toBe('false');
    buttonOf('Save').click();
    await settle();
    expect(patches()).toEqual([{ persona: 'ben', allowed: { writeNotes: false } }]);
  });

  it('req-258: the run settings save as one settings patch of what changed', async () => {
    await mount();
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
    expect(patches()).toEqual([{ persona: 'ben', settings: { readOnly: true, parallel: null, min: 1, leaving: ['commit'] } }]);
  });

  it('req-288: the model listbox offers Next free in class and the models of the class with their harness; a pin saves as model', async () => {
    await mount();
    q<HTMLButtonElement>('[data-field="pinned-model"]').click();
    expect([...fx.host.querySelectorAll('.persona-listbox [role="option"]')].map((option) => [option.textContent, option.getAttribute('aria-selected')])).toEqual([
      ['Next free in class', 'true'],
      ['opus · Claude Code', 'false'],
    ]);
    q<HTMLElement>('.persona-listbox [data-value="claude-code/opus"]').click();
    expect(fx.host.querySelector('.persona-listbox')).toBeNull();
    expect(q('[data-field="pinned-model"]').textContent).toBe('opus · Claude Code');
    buttonOf('Save').click();
    await settle();
    expect(patches()).toEqual([{ persona: 'ben', model: 'claude-code/opus' }]);
  });

  it('req-288: a class change drops a pin that is no model of the new class; without a table the shipped classes show', async () => {
    fx.view = { model: 'claude-code/opus' };
    await mount();
    expect(q('[data-field="pinned-model"]').textContent).toBe('opus · Claude Code');
    q<HTMLButtonElement>('.persona-seg-btn[data-value="light"]').click();
    expect(q('[data-field="pinned-model"]').textContent).toBe('Next free in class');
    buttonOf('Save').click();
    await settle();
    expect(patches()).toEqual([{ persona: 'ben', class: 'light', model: null }]);
    cleanFixture();
    resetFixture();
    fx.table = null;
    await mount();
    expect([...fx.host.querySelectorAll('.persona-seg-btn')].map((node) => node.textContent)).toEqual(['super heavy', 'heavy', 'standard', 'light']);
    expect(q('.persona-model-counts').textContent).toBe('0 heavy models · 0 free now');
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
    fx.view = { kind: 'mission', role: 'custom', model: '', phases: [], budget: null };
    fx.prompt = { text: '## Who Pia is\n\nMission Control.' };
    await mount();
    expect(q<HTMLInputElement>('[data-field="title"]').value).toBe('Ben');
    expect(editor().text).toBe('## Who Pia is\n\nMission Control.');
    for (const selector of ['[data-field="pinned-model"]', '[data-field="budget"]', '.persona-allow-row', '[data-proposal]', '.persona-delete-open']) {
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
