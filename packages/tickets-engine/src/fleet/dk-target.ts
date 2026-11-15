import type { PipelinePhase } from '../contracts/tickets';
import type { ChainStoreConfig, RunDkTarget } from './protocol';

/**
 * Where a run of the board claims its ticket (E14-5, E14-5b, req-265): the store, and whether it has
 * a `blocked` / `needs-input` stage to park in. A run ends with one release into `active` (dk
 * refuses an agent's same-stage release, R-31). One function for the board's owner-started runs and the
 * chain orchestrator, so both compose the same target.
 */
export function dkTargetFor(store: ChainStoreConfig, pipeline: readonly PipelinePhase[]): RunDkTarget {
  return {
    bin: store.dkPath,
    store: store.dkStore,
    dataDir: store.dkDataDir,
    checkout: store.dkCheckout,
    parkStage: pipeline.some((p) => p.id === 'blocked') ? 'blocked' : null,
    needsInputStage: pipeline.some((p) => p.id === 'needs-input') ? 'needs-input' : null,
    trailers: store.trailers,
  };
}
