/**
 * The capability columns of a model row in `service.json` (req-178):
 * `input` (a list of `text` / `image`), `tools` (true | false), `context`
 * and `output` (tokens). All optional — an absent column is "not
 * declared", which a step that needs it does not accept. Read tolerantly:
 * an input the routing does not ask about (`pdf`, `audio`) is dropped, a
 * value of the wrong kind leaves the row out with its reason.
 */
import { INPUT_MODALITIES, type InputModality, type ModelCapabilities } from '../protocol';

type Entry = Readonly<Record<string, unknown>>;
type Mutable = { -readonly [K in keyof ModelCapabilities]: ModelCapabilities[K] };

const isModality = (value: unknown): value is InputModality => typeof value === 'string' && (INPUT_MODALITIES as readonly string[]).includes(value);
const tokens = (value: unknown): number | null => (typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null);

function inputOf(raw: unknown, model: string, out: Mutable): string | null {
  if (raw === undefined) {
    return null;
  }
  if (!Array.isArray(raw) || !raw.every((item) => typeof item === 'string')) {
    return `model "${model}": input must be a list such as ["text", "image"]`;
  }
  out.input = [...new Set((raw as string[]).filter(isModality))];
  return null;
}

function sizeOf(raw: unknown, key: 'context' | 'output', model: string, out: Mutable): string | null {
  if (raw === undefined) {
    return null;
  }
  const value = tokens(raw);
  if (value === null) {
    return `model "${model}": ${key} must be a whole number of tokens`;
  }
  out[key] = value;
  return null;
}

/** A row's declared capabilities, or why they do not read. */
export function capabilitiesOf(entry: Entry, model: string): ModelCapabilities | string {
  const out: Mutable = {};
  const tools = entry['tools'];
  if (tools !== undefined && typeof tools !== 'boolean') {
    return `model "${model}": tools must be true or false`;
  }
  if (typeof tools === 'boolean') {
    out.tools = tools;
  }
  const problem = inputOf(entry['input'], model, out) ?? sizeOf(entry['context'], 'context', model, out) ?? sizeOf(entry['output'], 'output', model, out);
  return problem ?? out;
}

/** The columns a row declares, as `service.json` stores them. */
export function capabilityKeysOf(row: ModelCapabilities): Record<string, unknown> {
  return {
    ...(row.input !== undefined ? { input: row.input } : {}),
    ...(row.tools !== undefined ? { tools: row.tools } : {}),
    ...(row.context !== undefined ? { context: row.context } : {}),
    ...(row.output !== undefined ? { output: row.output } : {}),
  };
}
