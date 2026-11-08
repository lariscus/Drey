# Quota readout fixtures (req-177)

Recorded answers of Spike 4 (2026-11-08, the owner's accounts), secrets
and account ids redacted, otherwise verbatim — copied from
`docs/design/quota-samples-2026-11-08.md`, which also says how each was
taken. The specs never call the real endpoints.

| File | Source |
|---|---|
| `zai-quota-limit.json` | `GET https://api.z.ai/api/monitor/usage/quota/limit` — `unit` 3 + `number` 5 the five-hour window, `unit` 6 + `number` 1 the weekly one |
| `kimi-usages.json` | `GET https://api.kimi.ai/coding/v1/usages` — `usages.*` the quota windows, `limits[]` a request-rate window |
| `kimi-401.json` | the same endpoint with an expired token (HTTP 401) |
| `claude-rate-limit-event.json` | Claude Code 2.1.318 `-p` stream-json `rate_limit_event` |
| `claude-cached-usage.json` | `cachedUsageUtilization` of a `.claude.json` (whole percent, a stale September sample) |
