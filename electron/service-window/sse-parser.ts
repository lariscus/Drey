/** A server-sent event stream, cut into events as the bytes arrive (req-165). Pure. */
export interface SseEvent {
  readonly event: string;
  readonly data: string;
}

export class SseParser {
  private buffer = '';

  /** Feeds text; answers the events it completed. Comments (`: ping`) and `retry:` lines are dropped. */
  push(text: string): readonly SseEvent[] {
    this.buffer += text.replace(/\r\n/g, '\n');
    const events: SseEvent[] = [];
    let cut = this.buffer.indexOf('\n\n');
    while (cut >= 0) {
      const block = this.buffer.slice(0, cut);
      this.buffer = this.buffer.slice(cut + 2);
      const parsed = parseBlock(block);
      if (parsed !== null) {
        events.push(parsed);
      }
      cut = this.buffer.indexOf('\n\n');
    }
    return events;
  }
}

function parseBlock(block: string): SseEvent | null {
  let event = 'message';
  const data: string[] = [];
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) {
      event = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      data.push(line.slice(5).replace(/^ /, ''));
    }
  }
  return data.length === 0 ? null : { event, data: data.join('\n') };
}
