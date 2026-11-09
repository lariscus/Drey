import type { HeavyTask } from '../protocol-governor';

const TESTS = /\b(tests?|vitest|jest|mocha|playwright|pytest|e2e|ctest|verify|unit|specs?)\b/i;
const BUILD = /\b(build|tsc|typecheck|compile|pack|bundle|make|msbuild|webpack|esbuild|gradle|mvn)\b/i;

/** What a gate command is, as the log and the Governor block name it (`tests for T-0126`). */
export function heavyTaskOf(command: string): HeavyTask {
  if (TESTS.test(command)) {
    return 'tests';
  }
  return BUILD.test(command) ? 'build' : 'command';
}
