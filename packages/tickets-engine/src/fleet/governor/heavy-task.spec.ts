import { describe, expect, it } from 'vitest';
import { heavyTaskOf } from './heavy-task';

describe('heavyTaskOf', () => {
  it('names tests, builds and other commands', () => {
    expect(heavyTaskOf('npm test')).toBe('tests');
    expect(heavyTaskOf('npx vitest run src')).toBe('tests');
    expect(heavyTaskOf('npm run verify:unit')).toBe('tests');
    expect(heavyTaskOf('npm run e2e:run -- smoke')).toBe('tests');
    expect(heavyTaskOf('npm run build')).toBe('build');
    expect(heavyTaskOf('node node_modules/typescript/bin/tsc -p x --noEmit')).toBe('build');
    expect(heavyTaskOf('node scripts/check-cycles.mjs')).toBe('command');
  });
});
