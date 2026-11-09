import type { DreyPluginApi } from '../../../shared/plugin-api/renderer';
import type { CrewConfigReply, CrewKey, CrewOverrideMap } from '../shared/crew-config';
import { el } from './settings-dom';

type Loaded = Extract<CrewConfigReply, { ok: true }>;

/**
 * The vault layer's fields on Settings → Tickets (req-173, R13): the keys of
 * `tickets/_meta/crew.md` — the default worker, the dispatched runs'
 * permission mode, the handover thresholds — read once per page through the
 * engine (`crewConfig`) and written back one key at a time (`crewConfigSet`,
 * one commit each). An empty field removes the key: the built-in default
 * applies again and shows as the placeholder.
 */
export class CrewSettings {
  private loading: Promise<Loaded | null> | null = null;

  constructor(private readonly api: DreyPluginApi) {}

  /** The file's state; null while no tickets vault is detected. */
  load(): Promise<Loaded | null> {
    this.loading ??= (this.api.backend.invoke('crewConfig') as Promise<CrewConfigReply>)
      .then((reply) => (reply.ok ? reply : null))
      .catch(() => null);
    return this.loading;
  }

  /** The resolved value of a key (the file's, else the default). */
  async resolved(key: CrewKey): Promise<string | number | null | undefined> {
    return (await this.load())?.resolved[key];
  }

  select(key: CrewKey, choices: ReadonlyArray<readonly [string, string]>): HTMLSelectElement {
    const select = el('select');
    for (const [value, label] of choices) {
      select.append(Object.assign(el('option', undefined, label), { value }));
    }
    void this.resolved(key).then((value) => {
      if (typeof value === 'string') {
        select.value = value;
      }
    });
    select.addEventListener('change', () => void this.write([{ key, value: select.value }]));
    return select;
  }

  number(key: CrewKey): HTMLInputElement {
    const input = this.numberInput();
    void this.load().then((loaded) => {
      const own = loaded?.values[key];
      const fallback = loaded?.resolved[key];
      input.value = typeof own === 'number' ? String(own) : '';
      if (typeof fallback === 'number' && own === undefined) {
        input.placeholder = String(fallback);
      }
    });
    input.addEventListener('change', () => void this.write([this.patchOf(key, input.value)]));
    return input;
  }

  /** A per-provider/model override (`handover.compact-above-tokens-by.<name>`). */
  override(map: CrewOverrideMap, name: string): HTMLInputElement {
    const input = this.numberInput();
    void this.load().then((loaded) => {
      const own = loaded?.overrides[map][name];
      input.value = typeof own === 'number' ? String(own) : '';
    });
    input.addEventListener('change', () => {
      const parsed = Number(input.value);
      const value = input.value.trim() !== '' && Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : undefined;
      void this.write([], [{ map, name, ...(value !== undefined ? { value } : {}) }]);
    });
    return input;
  }

  private numberInput(): HTMLInputElement {
    const input = el('input', 'mono-input');
    input.type = 'number';
    input.min = '0';
    input.step = '1';
    return input;
  }

  private patchOf(key: CrewKey, text: string): { key: CrewKey; value?: number } {
    const parsed = Number(text);
    return text.trim() !== '' && Number.isFinite(parsed) && parsed >= 0 ? { key, value: Math.floor(parsed) } : { key };
  }

  private async write(patches: readonly { key: CrewKey; value?: string | number }[], overrides: readonly { map: CrewOverrideMap; name: string; value?: number }[] = []): Promise<void> {
    await this.api.backend.invoke('crewConfigSet', { patches, overrides }).catch(() => undefined);
    this.loading = null; // the next read sees the file as written
  }
}
