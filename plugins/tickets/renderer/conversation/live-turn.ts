/**
 * The answer a Mission Control turn is writing right now (D-76): the
 * stream's `thought` events (what she reads and calls) and `text` deltas
 * (the envelope's JSON fragments) folded into the message the Assistant
 * draws after the thread until the turn resolves.
 */
import type { ConversationMessage } from '../../../../shared/plugin-api/renderer';
import { liveEnvelopeOf } from './live-envelope';

/** The id of the in-flight answer in the thread. */
export const LIVE_MESSAGE_ID = 'live';

export class LiveTurn {
  /** The tool-call lines of the turn, one per call (`vault_read path …`). */
  private readonly steps: string[] = [];
  /** The text of the round in flight: the envelope's fragments so far. */
  private raw = '';

  /** A `thought` event is a step line and ends the round before it; a `text` event extends the round. */
  push(event: { readonly kind: 'thought' | 'text'; readonly text: string }): void {
    if (event.kind === 'thought') {
      const line = event.text.trim();
      if (line !== '') {
        this.steps.push(line);
      }
      this.raw = '';
    } else {
      this.raw += event.text;
    }
  }

  /** The in-flight message, or null while nothing has arrived. */
  message(): ConversationMessage | null {
    const answer = liveEnvelopeOf(this.raw);
    const thought = [...this.steps, ...(answer.thought === '' ? [] : [answer.thought])].join('\n');
    if (answer.say === '' && thought === '') {
      return null;
    }
    return {
      id: LIVE_MESSAGE_ID,
      role: 'agent',
      text: answer.say,
      ...(thought === '' ? {} : { thought }),
    };
  }
}
