import { readdirSync, readFileSync, statSync } from 'node:fs';
import * as path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * The Crew runner's import graph (ADR-0096, req-176): the layering is
 * asserted by the gate, not kept by discipline. ESLint carries the same
 * rules per file (`eslint.config.mjs`, "The Crew runner's import
 * boundaries"); this spec reads the whole graph at once and also checks
 * what a per-file rule cannot see.
 */

const FLEET = __dirname;

/** One import of one fleet file, as the compiler sees it. */
interface ImportEdge {
  /** The importing file, fleet-relative and `/`-separated (`run/run-state.ts`). */
  readonly from: string;
  /** The module specifier as written. */
  readonly specifier: string;
  /** The imported file, fleet-relative (`..`-prefixed outside fleet); null for a package or Node module. */
  readonly target: string | null;
  /** Every name the import brings in is a type: the compilers erase it. */
  readonly typeOnly: boolean;
}

const NODE_MODULES = new Set(['fs', 'path', 'os', 'child_process', 'http', 'https', 'net', 'util', 'crypto', 'stream']);

function isNodeModule(specifier: string): boolean {
  return specifier.startsWith('node:') || NODE_MODULES.has(specifier.split('/')[0] ?? '');
}

function isSpecOrFake(file: string): boolean {
  return file.endsWith('.spec.ts') || file.endsWith('.fake.ts') || file.endsWith('spec-support.ts');
}

function fleetFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      fleetFiles(full, out);
    } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
      out.push(path.relative(FLEET, full).replaceAll('\\', '/'));
    }
  }
  return out;
}

function typeOnlyClause(node: ts.ImportDeclaration | ts.ExportDeclaration): boolean {
  if (ts.isExportDeclaration(node)) {
    return node.isTypeOnly;
  }
  const clause = node.importClause;
  if (clause === undefined) {
    return false; // a side-effect import runs the module
  }
  if (clause.isTypeOnly) {
    return true;
  }
  const bindings = clause.namedBindings;
  return clause.name === undefined && bindings !== undefined && ts.isNamedImports(bindings) && bindings.elements.length > 0 && bindings.elements.every((e) => e.isTypeOnly);
}

/** The imports of one fleet file (static imports and re-exports). */
function importsOf(file: string, text: string): readonly ImportEdge[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, false);
  const edges: ImportEdge[] = [];
  for (const node of source.statements) {
    if ((!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) || node.moduleSpecifier === undefined) {
      continue;
    }
    const specifier = (node.moduleSpecifier as ts.StringLiteral).text;
    const target = specifier.startsWith('.') ? path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier)) : null;
    edges.push({ from: file, specifier, target: target === null ? null : target.replace(/\.js$/, ''), typeOnly: typeOnlyClause(node) });
  }
  return edges;
}

function graph(): readonly ImportEdge[] {
  return fleetFiles(FLEET).flatMap((file) => importsOf(file, readFileSync(path.join(FLEET, file), 'utf8')));
}

const inFolder = (file: string, folder: string): boolean => file.startsWith(`${folder}/`);

/** The parts that reach the machine only through `fleet/ports` (req-176 step 4). */
const NODE_FREE: readonly string[] = ['run', 'ports', 'orchestrate', 'routing', 'governor'];

/** Single files of other parts that stay Node-free: the adapter contract. */
const NODE_FREE_FILES: readonly string[] = ['harness/contract.ts'];

/** A module that wires a concrete adapter: only the composition root may import it at runtime. */
const CONCRETE = [/^harness\/claude-code$/, /^harness\/opencode$/, /^harness\/kimi(-.*)?$/, /^store\/dk-ticket-store$/];

/** What `fleet/routing` may import (req-177): the wire types, the ports, the adapter contract and the run core. */
const ROUTING_TARGETS = [/^routing\//, /^protocol(-[a-z-]+)?$/, /^ports\//, /^harness\/contract$/, /^run\//];

/**
 * The routing's decision (req-178): the filter, the choice, the step up, the
 * reserve, the estimates and the record are pure over what they are handed —
 * no port of the machine, no quota source, no registry, no network at runtime.
 */
const ROUTING_DECISION = /^routing\/(pool-grant|slot-fit|capability-filter|surplus-choice|step-up|reserve-guard|route-recorder|cost-estimate)\.ts$/;
const IMPURE_FOR_DECISION = /^(ports\/|routing\/(quota-source|[a-z-]+-quota-source|slot-registry|service-config-file|models-dev-import|run-share-tracker)$)/;

/** What `fleet/governor` may import (req-180): its own wire types and the ports' types. */
const GOVERNOR_TARGETS = [/^governor\//, /^protocol-governor$/, /^ports\//];

/** The violations of the rules over a set of edges; empty = the layering holds. */
function violations(edges: readonly ImportEdge[]): readonly string[] {
  const found: string[] = [];
  for (const edge of edges) {
    if (isSpecOrFake(edge.from)) {
      continue;
    }
    const where = `${edge.from} imports ${edge.specifier}`;
    const folder = NODE_FREE.find((f) => inFolder(edge.from, f)) ?? NODE_FREE_FILES.find((f) => edge.from === f);
    if (folder !== undefined && isNodeModule(edge.specifier)) {
      found.push(`${where}: fleet/${folder} reaches the machine only through fleet/ports`);
    }
    if (inFolder(edge.from, 'run') && edge.target !== null && !inFolder(edge.target, 'run') && !(edge.target === 'protocol' && edge.typeOnly)) {
      found.push(`${where}: fleet/run imports nothing outside itself but types from ../protocol`);
    }
    if (inFolder(edge.from, 'harness') && edge.target !== null && /^(orchestrate|api|store)\/|^runner$/.test(edge.target)) {
      found.push(`${where}: an adapter never imports the orchestration`);
    }
    if ((inFolder(edge.from, 'orchestrate') || inFolder(edge.from, 'api')) && edge.target !== null && inFolder(edge.target, 'routing')) {
      found.push(`${where}: the orchestration and the API ask the slots and the pool through their own interfaces (slot-binder, dispatch-pool, model-routes), never fleet/routing`);
    }
    if ((inFolder(edge.from, 'orchestrate') || inFolder(edge.from, 'api')) && edge.target !== null && inFolder(edge.target, 'governor')) {
      found.push(`${where}: the orchestration and the API ask the governor through their own interfaces (WorkerSeats, GateSeats, GovernorDesk), never fleet/governor`);
    }
    if (inFolder(edge.from, 'governor') && edge.target !== null && (!GOVERNOR_TARGETS.some((re) => re.test(edge.target!)) || (inFolder(edge.target, 'ports') && !edge.typeOnly))) {
      found.push(`${where}: fleet/governor takes ../protocol-governor and the types of ../ports only`);
    }
    if (ROUTING_DECISION.test(edge.from) && edge.target !== null && !edge.typeOnly && IMPURE_FOR_DECISION.test(edge.target)) {
      found.push(`${where}: the routing's decision is pure — no port, quota source, registry or network at runtime (req-178)`);
    }
    if (inFolder(edge.from, 'routing') && edge.target !== null && !ROUTING_TARGETS.some((re) => re.test(edge.target!))) {
      found.push(`${where}: fleet/routing takes the protocol, the ports, the adapter contract and the run core only`);
    }
    const concrete = edge.target !== null && !edge.typeOnly && CONCRETE.some((re) => re.test(edge.target!));
    const sameFolder = edge.target !== null && path.posix.dirname(edge.target) === path.posix.dirname(edge.from);
    if (concrete && edge.from !== 'runner.ts' && !sameFolder) {
      found.push(`${where}: only runner.ts wires a concrete adapter`);
    }
  }
  return found;
}

describe('the Crew runner import graph (ADR-0096)', () => {
  it('holds: run is pure, adapters never import the orchestration, only runner.ts wires adapters', () => {
    expect(violations(graph())).toEqual([]);
  });

  it('reads type-only imports apart from runtime ones', () => {
    const edges = importsOf('run/x.ts', "import type { A } from '../protocol';\nimport { type B } from '../protocol';\nimport { c } from '../protocol';\n");
    expect(edges.map((e) => e.typeOnly)).toEqual([true, true, false]);
    expect(edges[0]!.target).toBe('protocol');
  });

  it('reports a Node module in the pure core', () => {
    expect(violations(importsOf('run/x.ts', "import { promises } from 'node:fs';"))).toHaveLength(1);
    expect(violations(importsOf('ports/clock.ts', "import * as os from 'os';"))).toHaveLength(1);
    expect(violations(importsOf('orchestrate/run-repository.ts', "import { promises } from 'node:fs';"))).toHaveLength(1);
    expect(violations(importsOf('harness/contract.ts', "import { spawn } from 'node:child_process';"))).toHaveLength(1);
    expect(violations(importsOf('harness/opencode.ts', "import { spawn } from 'node:child_process';"))).toEqual([]);
  });

  it('reports a runtime import out of run/, but not a type from protocol', () => {
    expect(violations(importsOf('run/x.ts', "import { RunSupervisor } from '../orchestrate/run-supervisor';"))).toHaveLength(1);
    expect(violations(importsOf('run/x.ts', "import { DEFAULT_FLEET_CAPS } from '../protocol';"))).toHaveLength(1);
    expect(violations(importsOf('run/x.ts', "import type { RunInfo } from '../protocol';\nimport { y } from './y';"))).toEqual([]);
  });

  it('reports an adapter that imports the orchestration', () => {
    expect(violations(importsOf('harness/opencode.ts', "import type { LiveRun } from '../orchestrate/live-run';"))).toHaveLength(1);
    expect(violations(importsOf('harness/opencode.ts', "import { x } from './contract';"))).toEqual([]);
  });

  it('keeps routing on the protocol, the ports, the contract and the run core (req-177)', () => {
    expect(violations(importsOf('routing/x.ts', "import type { RunSupervisor } from '../orchestrate/run-supervisor';"))).toHaveLength(1);
    expect(violations(importsOf('routing/x.ts', "import { EventHub } from '../api/event-hub';"))).toHaveLength(1);
    expect(violations(importsOf('routing/x.ts', "import { promises } from 'node:fs';"))).toHaveLength(1);
    const allowed = [
      "import type { Clock } from '../ports/clock';",
      "import { isTerminal } from '../run/run-state';",
      "import type { SlotView } from '../protocol';",
      "import type { RateLimitReading } from '../harness/contract';",
      "import { y } from './y';",
    ];
    expect(violations(importsOf('routing/x.ts', allowed.join('\n')))).toEqual([]);
  });

  it("keeps the routing's decision pure: types of the machine at most (req-178)", () => {
    expect(violations(importsOf('routing/surplus-choice.ts', "import { SlotRegistry } from './slot-registry';"))).toHaveLength(1);
    expect(violations(importsOf('routing/slot-fit.ts', "import { ModelsDevImport } from './models-dev-import';"))).toHaveLength(1);
    expect(violations(importsOf('routing/step-up.ts', "import { SYSTEM_CLOCK } from '../ports/clock';"))).toHaveLength(1);
    const allowed = ["import type { ShareEstimates } from './reserve-guard';", "import type { Clock } from '../ports/clock';", "import { UNTABLED_COST } from './model-table';"];
    expect(violations(importsOf('routing/slot-fit.ts', allowed.join('\n')))).toEqual([]);
  });

  it('keeps the orchestration and the API off fleet/routing: the pool is asked through their own interfaces (req-170)', () => {
    expect(violations(importsOf('orchestrate/dispatcher.ts', "import type { PoolGrant } from '../routing/pool-grant';"))).toHaveLength(1);
    expect(violations(importsOf('api/model-routes.ts', "import { ModelTable } from '../routing/model-table';"))).toHaveLength(1);
    expect(violations(importsOf('orchestrate/pool.fake.ts', "import { PoolGrant } from '../routing/pool-grant';"))).toEqual([]);
    expect(violations(importsOf('compose-routing.ts', "import { PoolGrant } from './routing/pool-grant';"))).toEqual([]);
    expect(violations(importsOf('orchestrate/dispatcher.ts', "import type { ClassRequest } from '../protocol';"))).toEqual([]);
  });

  it('keeps the governor on its wire types and the ports, and the orchestration off the governor (req-180)', () => {
    expect(violations(importsOf('governor/x.ts', "import { cpus } from 'node:os';"))).toHaveLength(1);
    expect(violations(importsOf('governor/x.ts', "import type { LiveRun } from '../orchestrate/live-run';"))).toHaveLength(1);
    expect(violations(importsOf('governor/x.ts', "import { SYSTEM_CLOCK } from '../ports/clock';"))).toHaveLength(1);
    expect(violations(importsOf('orchestrate/gate-runner.ts', "import type { SeatLease } from '../governor/resource-governor';"))).toHaveLength(1);
    expect(violations(importsOf('api/governor-routes.ts', "import { SeatGovernor } from '../governor/seat-governor';"))).toHaveLength(1);
    const allowed = ["import type { Clock } from '../ports/clock';", "import { DEFAULT_DEV_PORTS } from '../protocol-governor';", "import { SeatTable } from './seat-table';"];
    expect(violations(importsOf('governor/x.ts', allowed.join('\n')))).toEqual([]);
    expect(violations(importsOf('compose-governor.ts', "import { SeatGovernor } from './governor/seat-governor';"))).toEqual([]);
  });

  it('reports a concrete adapter wired outside the composition root', () => {
    expect(violations(importsOf('orchestrate/x.ts', "import { claudeCodeAdapter } from '../harness/claude-code';"))).toHaveLength(1);
    expect(violations(importsOf('runner.ts', "import { claudeCodeAdapter } from './harness/claude-code';"))).toEqual([]);
    expect(violations(importsOf('orchestrate/x.spec.ts', "import { claudeCodeAdapter } from '../harness/claude-code';"))).toEqual([]);
    expect(violations(importsOf('orchestrate/x.ts', "import type { DkTicketStore } from '../store/dk-ticket-store';"))).toEqual([]);
  });
});
