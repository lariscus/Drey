/**
 * What a `session/new`, `session/load` or `session/resume` result offers
 * (req-182): the session modes and the model in use. ACP has two shapes
 * for modes — Kimi lists them in `modes.availableModes`, opencode as a
 * config option of category `mode` (`build`, `plan`); both are read here.
 */
export interface AcpSessionOffer {
  /** The mode ids offered; null when the result names none. */
  readonly modes: readonly string[] | null;
  /** The ids of the session's config options (`model`, `mode`, `effort`). */
  readonly configIds: readonly string[];
  /** The model the session runs when it says (`configOptions` → `model` → `currentValue`). */
  readonly model: string | null;
}

type Entry = Readonly<Record<string, unknown>>;

const isEntry = (value: unknown): value is Entry => typeof value === 'object' && value !== null && !Array.isArray(value);

function entries(value: unknown): readonly Entry[] {
  return Array.isArray(value) ? value.filter(isEntry) : [];
}

function idsOf(list: readonly Entry[], key: string): string[] {
  return list.map((e) => e[key]).filter((id): id is string => typeof id === 'string');
}

/** The mode ids of `modes.availableModes`, else of the config option of category `mode`; null when neither is there. */
function modesOf(result: Entry, options: readonly Entry[]): readonly string[] | null {
  const modes = result['modes'];
  if (isEntry(modes) && Array.isArray(modes['availableModes'])) {
    return idsOf(entries(modes['availableModes']), 'id');
  }
  const option = options.find((o) => o['category'] === 'mode' || o['id'] === 'mode');
  return option === undefined ? null : idsOf(entries(option['options']), 'value');
}

export function sessionOfferOf(result: Entry): AcpSessionOffer {
  const options = entries(result['configOptions']);
  const model = options.find((o) => o['id'] === 'model')?.['currentValue'];
  return { modes: modesOf(result, options), configIds: idsOf(options, 'id'), model: typeof model === 'string' && model !== '' ? model : null };
}
