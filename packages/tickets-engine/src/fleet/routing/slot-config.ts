/**
 * The `slots` of `service.json` (req-177; machine scope, ADR-0092 R13) as
 * slots. Every entry is checked on its own: a broken one is left out with
 * its reason, the others stand. A provider no entry names gets one implied
 * slot on its default login, so a machine without a `slots` key
 * runs as before — unless `impliedOff` names it (D-69: the owner removed
 * that stand-in, so there is no such slot here). Req-317: a quota belongs to
 * the account at the provider, not to the harness, so opencode gets one
 * implied slot per account (a provider entry of its `auth.json`, handed in
 * as the synthetic `opencodeAccounts` key by `ServiceConfigFile`) and keeps
 * its harness-wide stand-in only while it knows no account at all. An
 * implied slot has a key — a stand-in's is its provider id, an account's
 * its auth entry — and `impliedOff` lists keys. Req-290 retired the
 * `profile` key a slot once carried: it is read and silently ignored,
 * whatever it says.
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
/** What the owner knows an opencode account by (its `auth.json` entry); an entry not listed is shown as it is. */
const ACCOUNT_LABEL: Readonly<Record<string, string>> = { 'zai-coding-plan': 'z.ai Coding Plan', 'github-copilot': 'GitHub Copilot', openai: 'OpenAI', anthropic: 'Anthropic' };
const SLOT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,47}$/;

/** The synthetic, read-only root key `ServiceConfigFile.read()` fills with the entry names of opencode's `auth.json`; never written. */
export const OPENCODE_ACCOUNTS_KEY = 'opencodeAccounts';

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
  if (id === null || !SLOT_ID.test(id)) {
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
 * only for a slot `service.json` names, or for an opencode account that
 * reads one (`impliedAccountSlot`).
 */
export function impliedSlot(provider: WorkerProviderId): Slot {
  const quota: QuotaKind = provider === 'claude-code' ? 'claude-code' : 'counting';
  return { id: provider, label: IMPLIED_LABEL[provider], provider, billing: null, sessions: null, login: {}, quota, limits: [], implied: true };
}

/** req-317: the implied slot of one opencode account — its `auth.json` entry — on the quota that account reads (z.ai remotely, the rest counted). */
export function impliedAccountSlot(entry: string): Slot {
  const login: SlotLogin = { opencodeAuthEntry: entry };
  return { id: entry, label: ACCOUNT_LABEL[entry] ?? entry, provider: 'opencode', billing: null, sessions: null, login, quota: defaultQuotaKind('opencode', login), limits: [], implied: true };
}

/** The key `impliedOff` names an implied slot by: a stand-in's provider id, an account's auth entry. */
export function impliedKeyOf(slot: Slot): string {
  return slot.login.opencodeAuthEntry ?? slot.provider;
}

function refreshOf(root: Entry): number {
  const minutes = ((root['quota'] ?? {}) as Entry)['refreshMinutes'];
  return typeof minutes === 'number' && minutes >= 1 ? minutes * 60_000 : DEFAULT_REFRESH_MS;
}

/** The implied slots the owner removed (`impliedOff`, D-69), by key: no stand-in for them on this machine. */
export function impliedOffOf(root: Readonly<Record<string, unknown>>): readonly string[] {
  const raw = root['impliedOff'];
  return Array.isArray(raw) ? raw.filter((key): key is string => typeof key === 'string' && key !== '') : [];
}

/** The opencode accounts `ServiceConfigFile` found (each one a usable slot id), in the file's order, each once. */
export function opencodeAccountsOf(root: Readonly<Record<string, unknown>>): readonly string[] {
  const raw = root[OPENCODE_ACCOUNTS_KEY];
  const names = Array.isArray(raw) ? raw.filter((name): name is string => typeof name === 'string' && SLOT_ID.test(name)) : [];
  return [...new Set(names)];
}

/** The implied slots: one per provider no configured slot names — for opencode one per account instead of one for the harness. */
function impliedSlotsOf(config: Entry, configured: readonly Slot[]): Slot[] {
  const off = impliedOffOf(config);
  const accounts = opencodeAccountsOf(config);
  const named = new Set(configured.flatMap((slot) => (slot.login.opencodeAuthEntry === undefined ? [] : [slot.login.opencodeAuthEntry])));
  const taken = new Set(configured.map((slot) => slot.id));
  const unique = (slot: Slot): Slot => (taken.has(slot.id) ? { ...slot, id: `${slot.id}-default` } : slot);
  return WORKER_PROVIDERS.flatMap((provider): Slot[] => {
    if (provider === 'opencode') {
      const open = accounts.filter((entry) => !named.has(entry) && !off.includes(entry)).map(impliedAccountSlot);
      const standIn = accounts.length === 0 && !configured.some((slot) => slot.provider === 'opencode') && !off.includes(provider);
      return [...open, ...(standIn ? [impliedSlot(provider)] : [])].map(unique);
    }
    return off.includes(provider) || configured.some((slot) => slot.provider === provider) ? [] : [unique(impliedSlot(provider))];
  });
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
  return { slots: [...slots, ...impliedSlotsOf(config, slots)], errors, refreshMs: refreshOf(config) };
}
