import type { BoardParts } from './compose-board-parts';
import type { LearningParts } from './compose-learning-parts';
import type { RemoteParts } from './compose-remote-parts';
import type { SessionParts } from './compose-session-parts';
import type { VerifyParts } from './compose-verify-parts';
import type { FileConfigStore } from './file-config';

/** Every part the engine is composed of, grouped the way `engine.ts` builds them. */
export interface EngineParts {
  readonly config: FileConfigStore;
  readonly board: BoardParts;
  readonly verify: VerifyParts;
  readonly sessions: SessionParts;
  readonly remote: RemoteParts;
  readonly learning: LearningParts;
}
