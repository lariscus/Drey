import { timingSafeEqual } from 'node:crypto';
import type * as http from 'node:http';

/** The body of a request as text; the request is dropped past `cap` characters. */
export function readBody(req: http.IncomingMessage, cap: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    let text = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => {
      size += chunk.length;
      if (size > cap) {
        reject(new Error('the body is too large'));
        req.destroy();
        return;
      }
      text += chunk;
    });
    req.on('end', () => resolve(text));
    req.on('error', reject);
  });
}

/** Constant-time equality of two header values. */
export function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    return false;
  }
  return timingSafeEqual(ab, bb);
}
