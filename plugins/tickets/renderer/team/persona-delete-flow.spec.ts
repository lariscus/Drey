// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buttonOf, cleanFixture, fx, mount, q, resetFixture, settle, type } from './persona-page.harness';

beforeEach(resetFixture);
afterEach(cleanFixture);

const modal = (): HTMLElement => fx.modal!;
const field = (): HTMLInputElement => modal().querySelector<HTMLInputElement>('[data-field="delete-confirm"]')!;
const deleteButton = (): HTMLButtonElement => [...modal().querySelectorAll('button')].find((button) => button.textContent === 'Delete')!;
const removals = (): unknown[] => fx.invoked.filter(([method]) => method === 'personaRemove').map(([, payload]) => payload);
const press = (key: string): void => void field().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));

async function openAsk(): Promise<void> {
  await mount();
  buttonOf('Delete persona…').click();
}

describe('Delete persona… on the Persona page (req-261)', () => {
  it("sits at the footer's far side, opposite Discard and Save, as the danger action", async () => {
    await mount();
    const foot = q('.persona-foot');
    expect(foot.firstElementChild).toBe(buttonOf('Delete persona…'));
    expect(buttonOf('Delete persona…').classList.contains('persona-btn-danger')).toBe(true);
    expect([...foot.querySelectorAll('button')].map((button) => button.textContent)).toEqual(['Delete persona…', 'Discard', 'Save']);
  });

  it('opens a modal that names the persona, what goes and what stays, and asks for the title', async () => {
    await openAsk();
    expect(modal().querySelector('[role="alertdialog"]')).not.toBeNull();
    expect(modal().querySelector('h3')?.textContent).toBe('Delete Ben?');
    expect(modal().textContent).toContain('The prompt, memory, journal and own skills are deleted. Ticket history and chat files stay.');
    expect(modal().querySelector('label')?.textContent).toBe('Type Ben to confirm');
    expect(modal().querySelector('input')?.placeholder).toBe('');
    expect(deleteButton().disabled).toBe(true);
    expect(document.activeElement).toBe(field());
  });

  it('enables Delete only while the field is the title exactly: case and whitespace count', async () => {
    await openAsk();
    for (const typed of ['ben', 'BEN', ' Ben', 'Ben ', 'Be']) {
      type(field(), typed);
      expect(deleteButton().disabled).toBe(true);
    }
    type(field(), 'Ben');
    expect(deleteButton().disabled).toBe(false);
  });

  it('Enter submits only when Delete is enabled; Escape cancels and deletes nothing', async () => {
    await openAsk();
    type(field(), 'ben');
    press('Enter');
    await settle();
    expect(removals()).toEqual([]);
    expect(fx.modal).not.toBeNull();
    press('Escape');
    expect(fx.modal).toBeNull();
    expect(removals()).toEqual([]);
    expect(fx.removed).toBe(0);
  });

  it('Cancel closes the ask without a call', async () => {
    await openAsk();
    type(field(), 'Ben');
    [...modal().querySelectorAll('button')].find((button) => button.textContent === 'Cancel')!.click();
    expect(fx.modal).toBeNull();
    expect(removals()).toEqual([]);
  });

  it('deletes on the click, closes the ask, tells the page and has the Crew list read again', async () => {
    fx.replies['personaRemove'] = { ok: true, persona: 'ben', files: 3 };
    await openAsk();
    type(field(), 'Ben');
    deleteButton().click();
    await settle();
    expect(removals()).toEqual([{ persona: 'ben', confirm: 'Ben' }]);
    expect(fx.modal).toBeNull();
    expect(fx.removed).toBe(1);
    expect(fx.refreshes).toBeGreaterThan(0);
  });

  it('Enter in an enabled field deletes just the same', async () => {
    await openAsk();
    type(field(), 'Ben');
    press('Enter');
    await settle();
    expect(removals()).toEqual([{ persona: 'ben', confirm: 'Ben' }]);
    expect(fx.removed).toBe(1);
  });

  it("shows the engine's refusal in the ask, names the pinning columns, and keeps the ask and the page", async () => {
    fx.replies['personaRemove'] = { ok: false, code: 'pinned', error: 'pinned', columns: ['Build', 'Review'], crewDefault: false };
    await openAsk();
    type(field(), 'Ben');
    deleteButton().click();
    await settle();
    expect(modal().querySelector('[role="alert"]')?.textContent).toBe('The columns Build and Review pin Ben. Unpin it first.');
    expect(fx.removed).toBe(0);
    type(field(), 'Ben2');
    expect((modal().querySelector('[role="alert"]') as HTMLElement).hidden).toBe(true);
  });

  it('asks for the saved title, not an unsaved one', async () => {
    await mount();
    type(q<HTMLInputElement>('[data-field="title"]'), 'Benedict');
    buttonOf('Delete persona…').click();
    expect(modal().querySelector('h3')?.textContent).toBe('Delete Ben?');
    type(field(), 'Ben');
    deleteButton().click();
    await settle();
    expect(removals()).toEqual([{ persona: 'ben', confirm: 'Ben' }]);
    expect(fx.removed).toBe(1);
  });
});
