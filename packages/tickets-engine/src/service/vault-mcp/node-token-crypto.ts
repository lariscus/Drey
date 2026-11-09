/** {@link TokenCrypto} over Node's crypto: 32 random bytes, SHA-256 at rest (req-167). */
import { createHash, randomBytes } from 'node:crypto';
import type { TokenCrypto } from './run-tokens';

export class NodeTokenCrypto implements TokenCrypto {
  token(): string {
    return randomBytes(32).toString('hex');
  }

  hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
