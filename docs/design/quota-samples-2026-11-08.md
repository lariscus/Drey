# Quota readout samples (Spike 4, 2026-11-08)

Raw responses recorded on the owner's machine on 2026-11-08 for req-177
(slots per account with quota windows). Secrets and account ids are
redacted; everything else is verbatim. These are the fixtures the
`QuotaSource` implementations are tested against — the real endpoints are
never called in tests.

## z.ai — coding plan quota

`GET https://api.z.ai/api/monitor/usage/quota/limit` (the same body comes
from `https://open.bigmodel.cn/api/monitor/usage/quota/limit`), header
`Authorization: Bearer <coding-plan key>`; the key is the `zai-coding-plan`
(or `zai`) entry of opencode's `~/.local/share/opencode/auth.json`
(`{"type":"api","key":"…"}`).

```json
{"code":200,"msg":"Operation successful","data":{"limits":[
  {"type":"CREDIT_LIMIT","unit":3,"number":5,"usage":12000,"currentValue":181,"remaining":11818,"percentage":1,"nextResetTime":1794153648269},
  {"type":"CREDIT_LIMIT","unit":6,"number":1,"usage":60000,"currentValue":252,"remaining":59747,"percentage":1,"nextResetTime":1794670380996}
],"level":"pro"},"success":true}
```

Reading: `unit` 3 with `number` 5 is the five-hour window (its
`nextResetTime` 1794153648269 ms is about five hours after the call),
`unit` 6 with `number` 1 is the weekly window (reset about six days later).
`usage` is the window's credit budget, `currentValue` the credits spent,
`remaining` what is left, `percentage` the spent share in whole percent
(here 1 %). The unit enumeration is not documented; parse tolerantly and
classify a window by its reset distance when the unit is unknown.

## Kimi Code — coding usage

`GET https://api.kimi.ai/coding/v1/usages` (the host is the `base_url` of
the Kimi provider in `~/.kimi-code/config.toml`, `https://api.kimi.ai/coding/v1`;
`api.kimi.com` answers the same), header `Authorization: Bearer <access_token>`
from `~/.kimi-code/credentials/kimi-code-env-<id>.json`, a JSON object with
`access_token`, `expires_at` (epoch seconds), `expires_in`, `refresh_token`,
`scope`, `token_type`. The CLI refreshes the token when it runs; an expired
token answers HTTP 401
`{"error":{"message":"The API Key appears to be invalid or may have expired. Please verify your credentials and try again.","type":"invalid_authentication_error"}}`.
`/coding/v1/usage` (singular) is 404.

```json
{"limits":[{"window":{"duration":300,"timeUnit":"TIME_UNIT_MINUTE"},"detail":{"limit":"100","remaining":"100","resetTime":"2026-11-08T17:10:14.829731Z"}}],
 "usages":{"limit_5h":{"used_ratio":0.0024,"reset_time":"2026-11-08T17:10:14Z"},
           "limit_month_total":{"used_ratio":0.7764,"reset_time":"2026-12-01T10:13:07Z"},
           "limit_month_code":{"used_ratio":0.4528,"reset_time":"2026-12-01T10:13:07Z"}}}
```

Reading: `limits[]` is a request-rate window (300 minutes, 100 requests);
`usages` holds the quota windows as a spent ratio 0–1 with an ISO reset
time: `limit_5h`, `limit_month_total`, `limit_month_code`.

## Claude Code — the headless rate-limit event

`claude -p "…" --output-format stream-json --verbose --max-turns 1`
(Claude Code 2.1.318, logged in over OAuth, `apiKeySource: none`). The
stream's event order was: `system/init`, `system/commands_changed` (twice),
`assistant`, **`rate_limit_event`**, `system/post_turn_summary`, `result`.
The event:

```json
{"type":"rate_limit_event","rate_limit_info":{
  "status":"allowed_warning",
  "resetsAt":1794175200,
  "rateLimitType":"seven_day",
  "utilization":0.95,
  "overageStatus":"rejected",
  "overageDisabledReason":"org_level_disabled",
  "isUsingOverage":false,
  "surpassedThreshold":0.75,
  "unifiedWindows":{
    "five_hour":{"utilization":0.41,"resetsAt":1794159600,"status":"allowed"},
    "seven_day":{"utilization":0.95,"resetsAt":1794175200,"status":"allowed_warning","surpassedThreshold":0.75},
    "seven_day_overage_included":{"utilization":0.88,"resetsAt":1794175200,"status":"allowed_warning","surpassedThreshold":0.75}
  },
  "overageEnabled":false},
 "uuid":"<redacted>","session_id":"<redacted>"}
```

Reading: `utilization` is a ratio 0–1, `resetsAt` epoch **seconds**,
`status` one of `allowed | allowed_warning | rejected`; the top-level
fields repeat the most constrained window. The `result` event carries
`usage` (input/output/cache tokens) and `total_cost_usd`, no rate limit.
With an expired OAuth session the run fails before any event:
`assistant` with `error: "authentication_failed"` and the text
`Failed to authenticate: OAuth session expired and could not be refreshed`,
then `result` with `is_error: true`, `terminal_reason: "api_error"`.

## Claude Code — the per-account cache

`<CLAUDE_CONFIG_DIR>/.claude.json` (default `~/.claude.json`) holds
`cachedUsageUtilization`, written by the interactive session's usage fetch
(not by headless runs; the key was absent right after a fresh login).
Observed shape (a stale sample from September; values are **whole
percent**, unlike the event's ratios):

```json
{"cachedUsageUtilization":{
  "fetchedAtMs":1789851480936,
  "accountUuid":"<redacted>",
  "utilization":{
    "five_hour":{"utilization":9,"resets_at":"2026-09-20T00:10:00.471087+00:00","limit_dollars":null,"used_dollars":null,"remaining_dollars":null,"locked_reason":null},
    "seven_day":{"utilization":8,"resets_at":"2026-09-22T04:59:59.471109+00:00","limit_dollars":null,"used_dollars":null,"remaining_dollars":null,"locked_reason":null},
    "seven_day_oauth_apps":null,"seven_day_opus":null,"seven_day_sonnet":null,"seven_day_cowork":null,
    "extra_usage":{"is_enabled":false,"monthly_limit":10000,"used_credits":9181,"utilization":91.81,"currency":"USD","decimal_places":2,"disabled_reason":"out_of_credits","user_disabled":false,"spend_limit_reached":false,"credits_ever_enabled":true,"daily":null,"weekly":null},
    "limits":[{"kind":"session","group":"session"}]
  }},
 "oauthAccount":{"organizationRateLimitTier":"default_claude_max_5x"}}
```

Other keys of the file are the CLI's own; only `cachedUsageUtilization`
(and `oauthAccount.organizationRateLimitTier` for the tier) matter here.
The OAuth credentials live in `<CLAUDE_CONFIG_DIR>/.claude/.credentials.json`
under `claudeAiOauth` (`accessToken`, `expiresAt`, `rateLimitTier`,
`refreshToken`, `refreshTokenExpiresAt`, `scopes`, `subscriptionType`) —
never read or copied by the runner; the slot only names the config dir.
