/**
 * The parallelism a heavy command runs with (req-180): the CPUs left after
 * the reserve, shared by the heavy seats, at least one. Written as the
 * variables the common tools read themselves — vitest (4: `VITEST_MAX_WORKERS`,
 * 1–3: `VITEST_MAX_THREADS` / `VITEST_MAX_FORKS`), make (`MAKEFLAGS`), cargo
 * (`CARGO_BUILD_JOBS`), Go (`GOMAXPROCS`), .NET (`DOTNET_PROCESSOR_COUNT`),
 * Node's libuv pool (`UV_THREADPOOL_SIZE`, 2–4) — plus `DREY_TEST_WORKERS`
 * for tools without a variable of their own (Jest's `maxWorkers`,
 * Playwright's `workers`: a project config reads it). Pure.
 */
export interface ParallelismInput {
  readonly cpus: number;
  readonly heavySeats: number;
  /** Percent of CPU kept free. */
  readonly reserve: number;
}

/** The worker threads one heavy command gets. */
export function workersPerSeat(input: ParallelismInput): number {
  const usable = Math.floor((Math.max(1, input.cpus) * (100 - Math.min(90, Math.max(0, input.reserve)))) / 100);
  return Math.max(1, Math.floor(usable / Math.max(1, input.heavySeats)));
}

export function parallelismEnv(input: ParallelismInput): Readonly<Record<string, string>> {
  const workers = String(workersPerSeat(input));
  return {
    DREY_TEST_WORKERS: workers,
    VITEST_MAX_WORKERS: workers,
    VITEST_MAX_THREADS: workers,
    VITEST_MAX_FORKS: workers,
    MAKEFLAGS: `-j${workers}`,
    CARGO_BUILD_JOBS: workers,
    GOMAXPROCS: workers,
    DOTNET_PROCESSOR_COUNT: workers,
    UV_THREADPOOL_SIZE: String(Math.min(4, Math.max(2, Number(workers)))),
  };
}
