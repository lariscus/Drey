import type { PersonaModels } from '../core/persona';
import { parseWorkerValue } from '../fleet/assignment';
import { CAPABILITY_CLASSES, type ModelRow } from '../fleet/protocol-pool';

/**
 * The models a seeded persona gets (req-256): read from the machine's model
 * table (ADR-0095, `GET /models`), never a model id of ours. The rule: the
 * rows of the worker's harness provider, strongest class first (A, B, C; the
 * table's own order within a class), each model once — the first is
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
    const ordered = CAPABILITY_CLASSES.flatMap((cls) => rows.filter((row) => row.provider === parsed.provider && row.class === cls));
    const pool = [...new Set(ordered.map((row) => row.model))];
    if (pool.length === 0) {
      return null;
    }
    const first = parsed.model !== null && pool.includes(parsed.model) ? parsed.model : pool[0]!;
    return { default: first, pool: [first, ...pool.filter((model) => model !== first)] };
  }
}
