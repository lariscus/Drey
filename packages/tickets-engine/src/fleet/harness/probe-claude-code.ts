/**
 * What Claude Code offers (req-286): its own model list. Claude Code answers
 * the stream-json `initialize` control request — before any turn, so no
 * token is spent — with its version, the account it would run on
 * (`account.tokenSource`, `none` = signed out) and `models`: the entries of
 * its `/model` list, each with the model id it resolves to
 * (`opus` → `claude-opus-5-5`). Measured on Claude Code 2.1.319.
 */
import type { OfferedModel, ProbeOutcome } from '../protocol';
import type { SpawnFn } from '../ports/process-spawner';
import { LineBuffer } from './line-buffer';
import type { BinaryLocator } from './probe-binary';

export const CLAUDE_PROBE_ARGS: readonly string[] = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose'];
const PROBE_MS = 45_000;

type Entry = Readonly<Record<string, unknown>>;
const isEntry = (value: unknown): value is Entry => typeof value === 'object' && value !== null && !Array.isArray(value);
const textOf = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null);

/** The models of an `initialize` reply: each distinct resolved id, named by its description's head (`Opus 5.5`); the `default` entry only names what no other does. */
export function claudeModelsOf(reply: Entry): OfferedModel[] {
  const models: OfferedModel[] = [];
  const entries = Array.isArray(reply['models']) ? (reply['models'] as unknown[]).filter(isEntry) : [];
  const ordered = [...entries.filter((e) => e['value'] !== 'default'), ...entries.filter((e) => e['value'] === 'default')];
  for (const entry of ordered) {
    const model = textOf(entry['resolvedModel']) ?? (textOf(entry['value'])?.startsWith('claude-') === true ? textOf(entry['value']) : null);
    if (model === null || models.some((m) => m.model === model)) {
      continue;
    }
    const description = textOf(entry['description']);
    const head = description?.split(' · ')[0] ?? null;
    models.push({ model, name: head !== null && !head.startsWith('Use the default') ? head : textOf(entry['displayName']) });
  }
  return models;
}

/** The reply as a probe's outcome. */
export function claudeOutcomeOf(reply: Entry): ProbeOutcome {
  const account = isEntry(reply['account']) ? reply['account'] : null;
  const source = account === null ? null : textOf(account['tokenSource']);
  return { installed: true, version: textOf(reply['claude_code_version']), signedIn: source === null ? null : source !== 'none', models: claudeModelsOf(reply), error: null };
}

export class ClaudeCodeProbe {
  readonly provider = 'claude-code' as const;
  readonly label = 'Claude Code';

  constructor(
    private readonly spawnFn: SpawnFn,
    private readonly locator: BinaryLocator,
    private readonly cwd: string,
    private readonly timeoutMs: number = PROBE_MS,
  ) {}

  async probe(): Promise<ProbeOutcome> {
    if ((await this.locator.find('claude')) === null) {
      return { installed: false, version: null, signedIn: null, models: [], error: null };
    }
    const proc = this.spawnFn('claude', CLAUDE_PROBE_ARGS, { cwd: this.cwd });
    const lines = new LineBuffer();
    const outcome = await new Promise<ProbeOutcome>((resolve) => {
      const timer = setTimeout(() => resolve(failed('Claude Code did not answer initialize')), this.timeoutMs);
      const finish = (result: ProbeOutcome): void => {
        clearTimeout(timer);
        resolve(result);
      };
      proc.onStdout((chunk) => {
        for (const line of lines.feed(chunk)) {
          const reply = responseOf(line);
          if (reply !== null) {
            finish(claudeOutcomeOf(reply));
          }
        }
      });
      proc.onExit((code) => finish(failed(`Claude Code exited (${code ?? 'signal'}) before it answered`)));
      proc.write(`${JSON.stringify({ type: 'control_request', request_id: 'drey-probe', request: { subtype: 'initialize' } })}\n`);
    });
    proc.endInput();
    await proc.killTree().catch(() => undefined);
    return outcome;
  }
}

function failed(error: string): ProbeOutcome {
  return { installed: true, version: null, signedIn: null, models: [], error };
}

/** The `initialize` reply of one stdout line; null for any other line. */
function responseOf(line: string): Entry | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isEntry(parsed) || parsed['type'] !== 'control_response' || !isEntry(parsed['response'])) {
    return null;
  }
  const response = parsed['response'];
  return response['request_id'] === 'drey-probe' && isEntry(response['response']) ? response['response'] : null;
}
