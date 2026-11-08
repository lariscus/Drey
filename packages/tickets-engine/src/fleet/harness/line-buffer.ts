/** Splits a chunked text stream (a process's stdout, an SSE body) into whole lines, trimmed; empty lines dropped. */
export class LineBuffer {
  private buffer = '';

  feed(chunk: string): string[] {
    this.buffer += chunk;
    const lines: string[] = [];
    let at = this.buffer.indexOf('\n');
    while (at >= 0) {
      const line = this.buffer.slice(0, at).trim();
      this.buffer = this.buffer.slice(at + 1);
      at = this.buffer.indexOf('\n');
      if (line !== '') {
        lines.push(line);
      }
    }
    return lines;
  }
}

/** A process's stderr as stream notes: one per non-empty line, capped. */
export function stderrLines(chunk: string): string[] {
  return chunk
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => line.slice(0, 400));
}
