import { describe, expect, it } from 'vitest';
import { parallelismEnv, workersPerSeat } from './parallelism-env';

describe('parallelismEnv', () => {
  it('shares the CPUs left after the reserve among the heavy seats', () => {
    expect(workersPerSeat({ cpus: 8, heavySeats: 2, reserve: 25 })).toBe(3);
    expect(workersPerSeat({ cpus: 16, heavySeats: 1, reserve: 25 })).toBe(12);
    expect(workersPerSeat({ cpus: 16, heavySeats: 2, reserve: 0 })).toBe(8);
  });

  it('never goes below one worker', () => {
    expect(workersPerSeat({ cpus: 2, heavySeats: 2, reserve: 90 })).toBe(1);
    expect(workersPerSeat({ cpus: 0, heavySeats: 0, reserve: 50 })).toBe(1);
  });

  it('writes the variables the tools read', () => {
    const env = parallelismEnv({ cpus: 8, heavySeats: 2, reserve: 25 });
    expect(env).toMatchObject({ DREY_TEST_WORKERS: '3', VITEST_MAX_WORKERS: '3', VITEST_MAX_THREADS: '3', VITEST_MAX_FORKS: '3', MAKEFLAGS: '-j3', CARGO_BUILD_JOBS: '3', GOMAXPROCS: '3', DOTNET_PROCESSOR_COUNT: '3' });
  });

  it('keeps the libuv pool between two and four', () => {
    expect(parallelismEnv({ cpus: 2, heavySeats: 2, reserve: 50 })['UV_THREADPOOL_SIZE']).toBe('2');
    expect(parallelismEnv({ cpus: 32, heavySeats: 1, reserve: 0 })['UV_THREADPOOL_SIZE']).toBe('4');
  });
});
