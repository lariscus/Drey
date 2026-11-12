/**
 * One SSE body of the Mission Control bridge (D-1): blank-line frames,
 * `data:` lines, `[DONE]` ignored. Every content delta reaches `onDelta` as
 * it arrives (the UI's live text); the full accumulated reply returns for
 * the envelope parse. The walk ends when the body ends or the client's
 * signal aborts it — there is no clock in here (D-63, ADR-0014).
 */
import { deltaOf, type ChatDialect } from './chat-model';

/** The `data:` payload of one frame, its lines joined; '' for a frame without one. */
function dataOf(frame: string): string {
  return frame
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).replace(/^ /, ''))
    .join('\n');
}

export async function readSse(
  body: AsyncIterable<Uint8Array>,
  dialect: ChatDialect,
  onDelta: (delta: string) => void,
  signal: AbortSignal,
): Promise<{ readonly text: string }> {
  let text = '';
  let buffer = '';
  const decoder = new TextDecoder();
  for await (const chunk of body) {
    if (signal.aborted) {
      break;
    }
    buffer += decoder.decode(chunk, { stream: true });
    const frames = buffer.split(/\r?\n\r?\n/);
    buffer = frames.pop() ?? '';
    for (const frame of frames) {
      const data = dataOf(frame);
      if (data === '' || data === '[DONE]') {
        continue;
      }
      const delta = deltaOf(dialect, data);
      if (delta !== null && delta !== '') {
        text += delta;
        onDelta(delta);
      }
    }
  }
  return { text };
}
