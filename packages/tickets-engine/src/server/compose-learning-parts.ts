import { AGGREGATOR_SYSTEM_PROMPT, createChatBridge } from '../services/chat-llm';
import { ImprovementsService } from '../services/improvements-service';
import type { BoardParts } from './compose-board-parts';
import type { EngineOptions } from './engine-types';
import type { FileConfigStore } from './file-config';
import { settleCommitStepsOnFleet } from './settle-on-fleet';

type Log = NonNullable<EngineOptions['log']>;

/** What reacts to the fleet's settled runs: the self-improvement loop and the commit-step settling. */
export interface LearningParts {
  readonly improvements: ImprovementsService;
  /** Stops the commit-step settling's subscription. */
  readonly stopSettling: () => void;
}

/**
 * E6: the self-improvement loop — the aggregator watches the fleet's settled
 * runs per persona; when the friction pile crosses the threshold it
 * compacts findings into proposals through the LLM bridge (its own system
 * prompt), and the board persists them in one commit.
 */
export async function composeLearningParts(config: FileConfigStore, parts: BoardParts, log: Log): Promise<LearningParts> {
  const { board, hub } = parts;
  const improvements = new ImprovementsService({
    // The board speaks the house command objects; the service speaks
    // positional args — the seam adapts.
    board: {
      listPersonaIds: () => board.listPersonaIds(),
      improvementInput: (personaId) => board.improvementInput(personaId),
      applyAggregation: (personaId, drafts, now) => board.applyAggregation({ id: personaId, drafts, now: now.toISOString() }),
    },
    bridge: createChatBridge({ config, systemPrompt: AGGREGATOR_SYSTEM_PROMPT }),
    onRunsSettled: (listener) =>
      hub.subscribe((what) => {
        if (what === 'fleet') {
          listener();
        }
      }),
    log,
  });
  await improvements.start();
  const stopSettling = settleCommitStepsOnFleet(
    (listener) => hub.subscribe((what) => listener(what)),
    () => board.settleCommitSteps(),
    log,
  );
  return { improvements, stopSettling };
}
