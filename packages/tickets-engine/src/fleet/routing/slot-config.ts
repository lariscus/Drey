/**
 * The `slots` of `service.json` (req-177; machine scope, ADR-0092 R13) as
 * slots. Every entry is checked on its own: a broken one is left out with
 * its reason, the others stand. A provider no entry names gets one implied
 * slot on its default login, so a machine without a `slots` key
 * runs as before — unless `impliedOff` names the provider (D-69: the owner
 * removed that stand-in, so the provider has no slot here). Req-290
 * retired the `profile` key a slot once carried: it is read and silently
 * ignored, whatever it says.
 */
import { isWorkerProvider, WORKER_PROVIDERS, type QuotaKind, type SlotBilling, type WorkerProviderId } from '../protocol';
import type { Slot, SlotLimit, SlotLogin } from './slot';

export interface SlotConfigParse {
  readonly slots: readonly Slot[];
  /** One line per entry left out. */
  readonly errors: readonly string[];
  /** How often the remote quotas are read (`quota.refreshMinutes`, default 10). */
  readonly refreshMs: number;
}

export const DEFAULT_REFRESH_MS = 10 * 60_000;
const QUOTA_KINDS: readonly QuotaKind[] = ['claude-code', 'zai', 'kimi', 'counting'];
const LOGIN_KEYS: readonly (keyof SlotLogin)[] = ['claudeConfigDir', 'opencodeAuthEntry', 'opencodeAuthFile', 'kimiCredentials', 'kimiHome', 'copilotHome'];
const IMPLIED_LABEL: Readonly<Record<WorkerProviderId, string>> = { 'claude-code': 'Claude Code', opencode: 'OpenCode', kimi: 'Kimi', copilot: 'Copilot CLI' };

type Entry = Record<string, unknown>;
const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null);
const price = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null);

function billingOf(raw: unknown): SlotBilling | null {
  if (raw === null || typeof raw !== 'object') {
    return null;
  }
  const entry = raw as Entry;
  const currency = text(entry['currency']);
  const extra = currency === null ? {} : { currency };
  if (entry['kind'] === 'credits') {
    return { kind: 'credits', pricePerCredit: price(entry['pricePerCredit']), ...extra };
  }
  if (entry['kind'] === 'token') {
    return { kind: 'token', pricePerMillion: price(entry['pricePerMillion']), ...extra };
  }
  return entry['kind'] === 'subscription' ? { kind: 'subscription', pricePerMonth: price(entry['pricePerMonth']), ...extra } : null;
}

function loginOf(raw: unknown): SlotLogin {
  const login: Record<string, string> = {};
  if (raw !== null && typeof raw === 'object') {
    for (const key of LOGIN_KEYS) {
      const value = text((raw as Entry)[key]);
      if (value !== null) {
        login[key] = value;
      }
    }
  }
  return login;
}

function limitsOf(raw: unknown): SlotLimit[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.flatMap((item: unknown): SlotLimit[] => {
    const entry = (item ?? {}) as Entry;
    const window = entry['window'];
    const budget = entry['budget'];
    if ((window !== '5h' && window !== '7d' && window !== 'month') || typeof budget !== 'number' || !(budget > 0)) {
      return [];
    }
    return [{ window, budget, unit: entry['unit'] === 'runs' ? 'runs' : 'tokens' }];
  });
}

/** Where a slot's quota is read when the entry does not say: the provider's readout, z.ai by its opencode entry, else counting. */
export function defaultQuotaKind(provider: WorkerProviderId, login: SlotLogin): QuotaKind {
  if (provider === 'claude-code' || provider === 'kimi') {
    return provider;
  }
  return /^zai/i.test(login.opencodeAuthEntry ?? '') ? 'zai' : 'counting';
}

function sessionsOf(raw: unknown): number | null {
  return typeof raw === 'number' && Number.isInteger(raw) && raw > 0 ? raw : null;
}

/** One entry as a slot, or the reason it is left out. */
export function slotOf(raw: unknown, seen: ReadonlySet<string>): Slot | string {
  const entry = (raw !== null && typeof raw === 'object' ? raw : {}) as Entry;
  const id = text(entry['id']);
  if (id === null || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,47}$/.test(id)) {
    return `a slot needs an id of letters, digits, '.', '_' or '-' (got ${JSON.stringify(entry['id'] ?? null)})`;
  }
  if (seen.has(id)) {
    return `slot "${id}" is named twice`;
  }
  const provider = entry['provider'];
  if (!isWorkerProvider(provider)) {
    return `slot "${id}": provider must be one of ${WORKER_PROVIDERS.join(', ')}`;
  }
  const login = loginOf(entry['login']);
  const quota = QUOTA_KINDS.includes(entry['quota'] as QuotaKind) ? (entry['quota'] as QuotaKind) : defaultQuotaKind(provider, login);
  const base = { id, label: text(entry['label']) ?? id, provider, login, quota };
  return { ...base, billing: billingOf(entry['billing']), sessions: sessionsOf(entry['sessions']), limits: limitsOf(entry['limits']), implied: false };
}

/**
 * The stand-in slot of a provider no entry names: its default login. It
 * makes no network call: Claude Code's windows come from its own
 * runs and its cache, everything else is counted — a remote quota is read
 * only for a slot `service.json` names.
 */
export function impliedSlot(provider: WorkerProviderId): Slot {
  const quota: QuotaKind = provider === 'claude-code' ? 'claude-code' : 'counting';
  return { id: provider, label: IMPLIED_LABEL[provider], provider, billing: null, sessions: null, login: {}, quota, limits: [], implied: true };
}

function refreshOf(root: Entry): number {
  const minutes = ((root['quota'] ?? {}) as Entry)['refreshMinutes'];
  return typeof minutes === 'number' && minutes >= 1 ? minutes * 60_000 : DEFAULT_REFRESH_MS;
}

/** The providers whose implied slot the owner removed (`impliedOff`, D-69): no stand-in slot for them on this machine. */
export function impliedOffOf(root: Readonly<Record<string, unknown>>): readonly WorkerProviderId[] {
  const raw = root['impliedOff'];
  return Array.isArray(raw) ? raw.filter(isWorkerProvider) : [];
}

/** `service.json`'s parsed root as slots: the configured ones in their order, then the implied ones. */
export function parseServiceSlots(root: unknown): SlotConfigParse {
  const config = (root !== null && typeof root === 'object' && !Array.isArray(root) ? root : {}) as Entry;
  const raw = Array.isArray(config['slots']) ? (config['slots'] as unknown[]) : [];
  const slots: Slot[] = [];
  const errors: string[] = [];
  for (const entry of raw) {
    const slot = slotOf(entry, new Set(slots.map((s) => s.id)));
    if (typeof slot === 'string') {
      errors.push(slot);
    } else {
      slots.push(slot);
    }
  }
  const taken = new Set(slots.map((s) => s.id));
  const off = impliedOffOf(config);
  const implied = WORKER_PROVIDERS.filter((provider) => !off.includes(provider) && !slots.some((s) => s.provider === provider))
    .map(impliedSlot)
    .map((slot) => (taken.has(slot.id) ? { ...slot, id: `${slot.id}-default` } : slot));
  return { slots: [...slots, ...implied], errors, refreshMs: refreshOf(config) };
}
