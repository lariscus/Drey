/**
 * The live reading of a Mission Control reply while it streams (D-76).
 * The model answers with one JSON envelope (`{"say": …, "thought": …,
 * "commands": […]}`, `core/chat/chat-intents.ts` parses the finished one);
 * its text deltas arrive as fragments of that JSON. This reads whatever
 * has arrived — the `say` and `thought` strings so far, an unfinished one
 * included — so the thread can show them filling instead of the raw JSON.
 * Pure text in, text out; a reply that is no envelope (the bridge's own
 * fallback sentences) is plain `say`.
 */

/** What the reply says and thinks so far. */
export interface LiveAnswer {
  readonly say: string;
  readonly thought: string;
}

const EMPTY: LiveAnswer = { say: '', thought: '' };

const ESCAPES: Readonly<Record<string, string>> = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', '"': '"', '\\': '\\', '/': '/' };

interface Read {
  readonly value: string;
  /** Index after the closing quote, or -1 while the string is still open at the end of the text. */
  readonly end: number;
}

/** The JSON string whose opening quote is at `open`, decoded as far as it has arrived. */
function readString(text: string, open: number): Read {
  let value = '';
  let i = open + 1;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === '"') {
      return { value, end: i + 1 };
    }
    if (ch !== '\\') {
      value += ch;
      i += 1;
      continue;
    }
    const next = text[i + 1];
    if (next === undefined) {
      break;
    }
    if (next === 'u') {
      const hex = text.slice(i + 2, i + 6);
      if (hex.length < 4 || !/^[0-9a-fA-F]{4}$/.test(hex)) {
        break;
      }
      value += String.fromCharCode(parseInt(hex, 16));
      i += 6;
      continue;
    }
    value += ESCAPES[next] ?? next;
    i += 2;
  }
  return { value, end: -1 };
}

/** Index of the end of the value that starts at `from` (a non-string one: number, array, object), or -1 while it is open. */
function skipValue(text: string, from: number): number {
  let depth = 0;
  for (let i = from; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '"') {
      const read = readString(text, i);
      if (read.end < 0) {
        return -1;
      }
      i = read.end - 1;
    } else if (ch === '{' || ch === '[') {
      depth += 1;
    } else if (ch === '}' || ch === ']') {
      if (depth === 0) {
        return i;
      }
      depth -= 1;
    } else if (ch === ',' && depth === 0) {
      return i;
    }
  }
  return -1;
}

const WHITESPACE = /\s/;

function skipSpace(text: string, from: number): number {
  let i = from;
  while (i < text.length && (WHITESPACE.test(text[i]!) || text[i] === ',')) {
    i += 1;
  }
  return i;
}

/** The `say` and `thought` of an envelope that has arrived in part; a text without a `{` is a plain `say`. */
export function liveEnvelopeOf(raw: string): LiveAnswer {
  const text = raw.replace(/^\s*```[a-z]*\s*/i, '').replace(/^\s+/, '');
  if (text === '') {
    return EMPTY;
  }
  const start = text.indexOf('{');
  if (start < 0) {
    return { say: text.trimEnd(), thought: '' };
  }
  const found: Record<string, string> = {};
  let i = skipSpace(text, start + 1);
  while (i < text.length && text[i] === '"') {
    const key = readString(text, i);
    if (key.end < 0) {
      break;
    }
    i = skipSpace(text, key.end);
    if (text[i] !== ':') {
      break;
    }
    i = skipSpace(text, i + 1);
    if (i >= text.length) {
      break;
    }
    if (text[i] === '"') {
      const value = readString(text, i);
      if (key.value === 'say' || key.value === 'thought') {
        found[key.value] = value.value;
      }
      if (value.end < 0) {
        break;
      }
      i = skipSpace(text, value.end);
    } else {
      const end = skipValue(text, i);
      if (end < 0) {
        break;
      }
      i = skipSpace(text, end);
    }
  }
  return { say: found['say'] ?? '', thought: found['thought'] ?? '' };
}
