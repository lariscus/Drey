/**
 * What Settings → Background service stores (board 8c), as the service
 * reads it every tick from the engine's config — Drey writes every
 * preference there too (`plugins/tickets/main/service-settings.ts`). One
 * parse for both sides: `shared/service-settings.ts`.
 */
import { SERVICE_PREF_KEYS, servicePrefsOf, type ServicePrefs } from '../../../../shared/service-settings';

/** The config the settings live in (the engine's `FileConfigStore`). */
export interface SettingsSource {
  get<T>(key: string): Promise<T | undefined>;
}

export class ServiceSettingsReader {
  constructor(private readonly source: () => SettingsSource | null) {}

  /** Every preference, a missing or malformed one its default. */
  async read(): Promise<ServicePrefs> {
    const source = this.source();
    const stored = new Map<string, unknown>();
    if (source !== null) {
      for (const key of Object.values(SERVICE_PREF_KEYS)) {
        stored.set(key, await source.get<unknown>(key).catch(() => undefined));
      }
    }
    return servicePrefsOf((key) => stored.get(key));
  }
}
