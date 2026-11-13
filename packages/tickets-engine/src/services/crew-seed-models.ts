import type { PersonaModels } from '../core/persona';
import { parseWorkerValue } from '../fleet/assignment';
import { CAPABILITY_CLASSES, type ModelRow } from '../fleet/protocol-pool';

/**
 * The models a seeded persona gets (req-256): read from the machine's model
 * table (ADR-0095, `GET /models`), never a model id of ours. The rule: the
 * rows of the worker's harness provider the router may use, strongest class
 * first (super heavy, heavy, standard, light — a class of the owner's own
 * after them; the table's own order within a class, req-287), each model once — the first is
 * `models.default`, all of them are the `pool`, so the capacity pool grants
 * whichever class a ticket asks for. A worker that pins a model
 * (`opencode/<model>`) puts that model first when the table holds it. No
 * rows for the worker (an `api` persona, a machine without a table, a
 * worker the table does not serve) = null: the persona keeps the parser's
 * default and the seeder says so.
 */
export class CrewSeedModels {
  pick(worker: string, rows: readonly ModelRow[] | null): PersonaModels | null {
    const parsed = parseWorkerValue(worker);
    if (parsed === null || rows === null) {
      return null;
    }
    const rank = (cls: string): number => (CAPABILITY_CLASSES.includes(cls) ? CAPABILITY_CLASSES.indexOf(cls) : CAPABILITY_CLASSES.length);
    const ordered = rows
      .filter((row) => row.provider === parsed.provider && row.enabled)
      .map((row, at) => ({ row, at }))
      .sort((a, b) => rank(a.row.class) - rank(b.row.class) || a.at - b.at)
      .map(({ row }) => row);
    const pool = [...new Set(ordered.map((row) => row.model))];
    if (pool.length === 0) {
      return null;
    }
    const first = parsed.model !== null && pool.includes(parsed.model) ? parsed.model : pool[0]!;
    return { default: first, pool: [first, ...pool.filter((model) => model !== first)] };
  }
}
