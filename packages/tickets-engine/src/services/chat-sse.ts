/**
 * One SSE body of the Mission Control bridge (D-1): blank-line frames,
 * `data:` lines, `[DONE]` ignored. Every text delta reaches `onDelta` as it
 * arrives (the UI's live text); the accumulated reply returns for the
 * envelope parse — with the round's tool calls when the model made any
 * (req-315, the shared `shared/llm` sinks accumulate both dialects'
 * fragments). The walk ends when the body ends or the client's signal
 * aborts it — there is no clock in here (D-63, ADR-0014).
 */
import { createAnthropicEventSink, createOpenAiChunkSink, type ChatToolCall } from '../../../../shared/llm';
import type { ChatDialect } from './chat-model';

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
): Promise<{ readonly text: string; readonly toolCalls: readonly ChatToolCall[] }> {
  const sink = dialect === 'anthropic' ? createAnthropicEventSink() : createOpenAiChunkSink();
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
      let payload: unknown;
      try {
        payload = JSON.parse(data) as unknown;
      } catch {
        continue;
      }
      const delta = sink.push(payload);
      if (delta !== null && delta !== '') {
        onDelta(delta);
      }
    }
  }
  return { ...sink.result() };
}
