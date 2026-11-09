/**
 * The machine's load as the resource governor asks it (req-180, ADR-0096):
 * CPU busy share since the previous sample and memory in use, both in
 * percent, plus the logical CPU count the parallelism variables divide.
 * The Node adapter is `NodeSystemLoad` over `os`.
 */
export interface LoadSample {
  /** Percent of CPU time busy since the previous sample (0–100); null on the first sample. */
  readonly cpu: number | null;
  /** Percent of physical memory in use (0–100). */
  readonly memory: number;
}

export interface SystemLoad {
  sample(): LoadSample;
  /** Logical CPUs. */
  cpuCount(): number;
}
