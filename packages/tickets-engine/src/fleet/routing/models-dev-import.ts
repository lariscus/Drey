import { INPUT_MODALITIES, type InputModality, type ModelCapabilities, type ModelRow, type WorkerProviderId } from '../protocol';
import type { HttpReply } from './quota-source';

/** The open model registry's one file (`{ <provider>: { models: { <id>: { modalities, tool_call, limit } } } }`). */
export const MODELS_DEV_URL = 'https://models.dev/api.json';

/** A GET over the network (the composition root wires `fetch`; the quota sources use the same port). */
export interface RegistryHttp {
  getJson(url: string, headers: Readonly<Record<string, string>>): Promise<HttpReply>;
}

/** One row the import filled, and with which columns. */
export interface FilledRow {
  readonly model: string;
  readonly where: string;
  readonly fields: readonly string[];
}

export type ImportOutcome =
  | { readonly ok: true; readonly rows: readonly ModelRow[]; readonly filled: readonly FilledRow[]; readonly unmatched: readonly string[] }
  | { readonly ok: false; readonly error: string };

type Json = Readonly<Record<string, unknown>>;

/** Where a harness's models are looked up first; any other provider after. */
const PROVIDERS_OF: Readonly<Record<WorkerProviderId, readonly string[]>> = {
  'claude-code': ['anthropic'],
  opencode: ['zai-coding-plan', 'zai', 'anthropic', 'github-copilot'],
  kimi: ['kimi-code-plan-global', 'moonshotai', 'kimi-code-plan-cn', 'moonshotai-cn'],
  copilot: ['github-copilot', 'anthropic', 'openai'],
};

const objectOf = (value: unknown): Json | null => (value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : null);
const tokens = (value: unknown): number | undefined => (typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined);

/** The registry's entry for a row's model: its own provider prefix first, the harness's providers next, any provider last. */
function entryOf(registry: Json, row: ModelRow): Json | null {
  const slash = row.model.indexOf('/');
  const id = slash >= 0 ? row.model.slice(slash + 1) : row.model;
  const prefix = slash >= 0 ? [row.model.slice(0, slash)] : [];
  const order = [...prefix, ...PROVIDERS_OF[row.provider], ...Object.keys(registry)];
  for (const provider of order) {
    const found = objectOf(objectOf(objectOf(registry[provider])?.['models'])?.[id]);
    if (found !== null) {
      return found;
    }
  }
  return null;
}

/** What the registry declares of one model, in the table's columns. */
function declared(entry: Json): ModelCapabilities {
  const input = objectOf(entry['modalities'])?.['input'];
  const limit = objectOf(entry['limit']);
  const modalities = Array.isArray(input) ? input.filter((m): m is InputModality => (INPUT_MODALITIES as readonly unknown[]).includes(m)) : undefined;
  const context = tokens(limit?.['context']);
  const output = tokens(limit?.['output']);
  return {
    ...(modalities !== undefined ? { input: modalities } : {}),
    ...(typeof entry['tool_call'] === 'boolean' ? { tools: entry['tool_call'] } : {}),
    ...(context !== undefined ? { context } : {}),
    ...(output !== undefined ? { output } : {}),
  };
}

/**
 * The one-shot capability import from models.dev (req-178): the owner asks
 * for it (Settings → Models, `POST /models/import`), it is never automatic.
 * It fills only the columns a row does not declare — what the owner wrote
 * is the local override and stays. A model the registry does not list is
 * named, never guessed.
 */
export class ModelsDevImport {
  constructor(
    private readonly http: RegistryHttp,
    private readonly url: string = MODELS_DEV_URL,
  ) {}

  async fill(rows: readonly ModelRow[]): Promise<ImportOutcome> {
    const reply = await this.http.getJson(this.url, {}).catch((error: unknown) => ({ status: 0, body: null, error }));
    const registry = objectOf(reply.body);
    if (reply.status !== 200 || registry === null) {
      return { ok: false, error: `${this.url} answered ${reply.status === 0 ? 'nothing' : `HTTP ${reply.status}`} — the model table is unchanged` };
    }
    const filled: FilledRow[] = [];
    const unmatched: string[] = [];
    const next = rows.map((row) => {
      const entry = entryOf(registry, row);
      if (entry === null) {
        unmatched.push(row.model);
        return row;
      }
      const found = declared(entry);
      const fields = (Object.keys(found) as (keyof ModelCapabilities)[]).filter((key) => row[key] === undefined);
      if (fields.length > 0) {
        filled.push({ model: row.model, where: row.slot ?? row.provider, fields });
      }
      return { ...row, ...Object.fromEntries(fields.map((key) => [key, found[key]])) } as ModelRow;
    });
    return { ok: true, rows: next, filled, unmatched };
  }
}
