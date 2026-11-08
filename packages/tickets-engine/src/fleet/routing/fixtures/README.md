# Quota readout fixtures (req-177)

Sample responses for the contract specs of the three quota sources. The
tests never call the real endpoints.

| File | Source | Provenance |
|---|---|---|
| `claude-rate-limit-event.json` | Claude Code `-p` stream-json `rate_limit_event` | shape as recorded by Spike 4 (CLI 2.1.318) and pinned in `harness/claude-code-rate-limit.spec.ts`; values invented |
| `zai-quota-limit.json` | `GET https://api.z.ai/api/monitor/usage/quota/limit` | **reconstructed** from Spike 4's field list (`unit`, `number`, `usage`, `currentValue`, `remaining`, `percentage`, `nextResetTime`); the numeric unit codes (3 hours, 6 weeks, 5 months) and the `TIME_LIMIT` entry are assumptions — replace with a recorded answer when one is captured |
| `kimi-usages.json` | `GET https://api.kimi.ai/coding/v1/usages` | **reconstructed** from Spike 4's field list (`limit_5h`, `limit_month_total`, `limit_month_code` with `used_ratio`, `reset_time`); the `reset_time` format is an assumption (the parser also reads epoch seconds and ms) |
| `claude-cached-usage.json` | `cachedUsageUtilization` in a `CLAUDE_CONFIG_DIR`'s `.claude.json` | **reconstructed**: Spike 4 named the key, not its shape; the parser reads snake and camel case and 0–1 or 0–100 |
