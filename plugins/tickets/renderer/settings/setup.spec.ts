// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type { DreyPluginApi } from '../../../../shared/plugin-api/renderer';
import { createTicketsSetup } from './setup';

/** D-74: the block's two dialog entries ride one flow — pick, then set up;
 * the page reloads on success and the failure lands on the line below. */
describe('createTicketsSetup', () => {
  function mount(invoke: (method: string, payload?: unknown) => Promise<unknown>, onConfigured: () => void = () => undefined) {
    const api = { backend: { invoke } } as unknown as DreyPluginApi;
    const block = createTicketsSetup(api, onConfigured);
    document.body.replaceChildren(block.root);
    const [create, existing] = [...block.root.querySelectorAll('button')];
    return { block, create: create as HTMLButtonElement, existing: existing as HTMLButtonElement };
  }

  const settle = async (): Promise<void> => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
  };

  it('starts the setup with the picked folder and reloads on success', async () => {
    const invoke = vi.fn((method: string) => {
      if (method === 'pickFolder') {
        return Promise.resolve({ ok: true, path: 'E:/tickets' });
      }
      return Promise.resolve({ ok: true });
    });
    const onConfigured = vi.fn();
    const { create } = mount(invoke, onConfigured);
    create.click();
    await settle();
    expect(invoke).toHaveBeenCalledWith('pickFolder', expect.objectContaining({ title: expect.any(String) }));
    expect(invoke).toHaveBeenCalledWith('setupTicketsVault', { folder: 'E:/tickets' });
    expect(onConfigured).toHaveBeenCalledTimes(1);
    expect(create.disabled).toBe(false);
    expect(create.textContent).toBe('Create a tickets repository…');
  });

  it('does nothing when the dialog is cancelled', async () => {
    const invoke = vi.fn(() => Promise.resolve({ ok: true }));
    const onConfigured = vi.fn();
    mount(invoke, onConfigured);
    (document.querySelector('.tset-setup-actions button') as HTMLButtonElement).click();
    await settle();
    expect(invoke).toHaveBeenCalledTimes(1); // the picker only
    expect(onConfigured).not.toHaveBeenCalled();
  });

  it('shows a failed setup on the error line and re-enables the entries', async () => {
    const invoke = vi.fn((method: string) =>
      method === 'pickFolder' ? Promise.resolve({ ok: true, path: 'E:/x' }) : Promise.resolve({ ok: false, error: 'neither empty nor a git repository' }),
    );
    const onConfigured = vi.fn();
    const { create, existing } = mount(invoke, onConfigured);
    existing.click();
    await settle();
    expect(document.querySelector('.tset-setup-error')?.textContent).toBe('neither empty nor a git repository');
    expect(onConfigured).not.toHaveBeenCalled();
    expect(create.disabled).toBe(false);
    expect(existing.disabled).toBe(false);
  });

  it('keeps the entries idle while a setup runs', async () => {
    let releasePick!: (value: unknown) => void;
    const invoke = vi.fn((method: string) =>
      method === 'pickFolder'
        ? new Promise((resolve) => {
            releasePick = resolve;
          })
        : Promise.resolve({ ok: true }),
    );
    const { create, existing } = mount(invoke);
    create.click();
    expect(create.disabled).toBe(true);
    expect(existing.disabled).toBe(true);
    existing.click(); // the second entry is ignored while the first runs
    releasePick({ ok: true, path: 'E:/one' });
    await settle();
    expect(invoke).toHaveBeenCalledWith('setupTicketsVault', { folder: 'E:/one' });
    expect(create.disabled).toBe(false);
  });
});
