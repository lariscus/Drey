/**
 * The machine layer of the configuration (req-173, R13, ADR-0092 later
 * change): `service.json` in the service home — what this computer is.
 * One file, read and written only through `ServiceConfigFile`; each root
 * key is parsed by the part that owns it, and this table is the schema
 * every reader and the docs (`plugins/tickets/SERVICE.md`) share. No vault
 * key (`tickets/_meta/crew.md`) and no session record overrides a key of
 * this file — `fleet/config/layered-config-resolver.ts`.
 */

/** The root keys of `service.json`, each with its owner and what it holds. */
export const SERVICE_JSON_KEYS = {
  slots: 'req-177 · routing/slot-config.ts — the accounts per provider: id, label, provider, profile, login folder, sessions',
  quota: 'req-177 · routing/slot-config.ts — the quota sources per provider (Claude Code, Kimi, z.ai), their refresh',
  models: 'req-170 · routing/pool-config.ts — the model table: model id, provider, category, class, cost factor, capabilities',
  capacity: 'req-170 · routing/pool-config.ts — the capacity cap: global and per provider',
  ledgers: 'req-170 · routing/pool-config.ts — the ticket allowance, the persona day and provider day defaults',
  routing: 'req-178/181 · routing/pool-config.ts — the surplus and step-up thresholds, the reserve, the burn rate',
  governor: 'req-180 · governor/ — the dev-port range (`devPorts`); the load preferences are Settings → Background service, config.json service.load.*',
  migrations: 'req-170 · routing/pool-migration.ts — the one-time moves already done on this machine',
} as const;

export type ServiceJsonKey = keyof typeof SERVICE_JSON_KEYS;

/** The file's shape as a type (each value is checked by its owner's parser). */
export type ServiceJson = Partial<Record<ServiceJsonKey, unknown>>;
