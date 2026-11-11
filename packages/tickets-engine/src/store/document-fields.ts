/**
 * One header field of a dricket ticket document set or removed (req-265: `stage:` and the interim
 * `x-phase:` pin). Pure text: the line order, the body and the file's line ending stay as they are;
 * dk validates the result when it is written.
 */

const FENCE = '---';

/**
 * `text` with `key: value` (null removes the line). An existing line is replaced in place, a new one
 * goes last in the header. Null when the text is not a ticket document (no closed front matter).
 */
export function setDocumentField(text: string, key: string, value: string | null): string | null {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  if (lines[0] !== FENCE) {
    return null;
  }
  const close = lines.indexOf(FENCE, 1);
  if (close < 0) {
    return null;
  }
  const at = lines.findIndex((line, i) => i > 0 && i < close && line.startsWith(`${key}:`));
  if (at >= 0) {
    if (value === null) {
      lines.splice(at, 1);
    } else {
      lines[at] = `${key}: ${value}`;
    }
  } else if (value !== null) {
    lines.splice(close, 0, `${key}: ${value}`);
  }
  return lines.join(eol);
}

/** A header field's value, or null when the document has no such line. */
export function documentField(text: string, key: string): string | null {
  const lines = text.split(/\r?\n/);
  if (lines[0] !== FENCE) {
    return null;
  }
  const close = lines.indexOf(FENCE, 1);
  const line = lines.find((l, i) => i > 0 && (close < 0 || i < close) && l.startsWith(`${key}:`));
  return line === undefined ? null : line.slice(key.length + 1).trim();
}
