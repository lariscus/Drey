/**
 * The boards' sample data (8a / 8b): what the window shows in a plain
 * browser and in specs, where no preload bridge exists. Times are built
 * relative to the clock so the "idle 4 min" style spans read right.
 */
import type {
  LogLine,
  ServiceSnapshot,
  SessionRun,
  StreamEvent,
} from '../../../../../shared/service-window/contract';

function today(time: string): string {
  const now = new Date();
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${time}`;
}

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

export function demoSnapshot(): ServiceSnapshot {
  return {
    running: true,
    pid: 18240,
    startedAt: today('08:12:00'),
    components: {
      engine: { state: 'running', address: '127.0.0.1:52114', vaultName: 'drey-tickets' },
      runner: { state: 'running', reason: null, liveRuns: 2 },
      mcp: { state: 'running', detail: '127.0.0.1:4319 · 3 clients (2 runs, Claude Desktop)' },
      gateway: { state: 'stopped', address: null, devices: 0, reason: null },
      model: { reachable: false, name: 'LM Studio', lastSeen: today('07:40:00') },
    },
    spend: { spent: 4.1, limit: 15 },
    slots: [
      { id: 'claude-a', label: 'Claude A', busy: 1, total: 2, left: 0.62, q: 1.4, resetsAt: '2026-11-09T09:00:00', reliability: 'measured' },
      { id: 'claude-b', label: 'Claude B', busy: 0, total: 1, left: 0.31, q: 0.8, resetsAt: '2026-11-10T14:00:00', reliability: 'measured' },
      { id: 'zai', label: 'z.ai', busy: 1, total: 3, left: 0.7, q: 1.2, resetsAt: '2026-11-11T00:00:00', reliability: 'estimated' },
      { id: 'kimi', label: 'Kimi', busy: 0, total: 2, left: null, q: null, resetsAt: null, reliability: 'unknown' },
    ],
    load: { heavySeats: 2, reserve: 25, lowPriority: true, quietHours: '22:00 - 07:00' },
    governor: {
      heavy: { busy: 1, total: 2, holders: [{ ticket: 'T-0126', task: 'tests' }] },
      light: { busy: 2, total: 6 },
      load: 41,
      reserve: 25,
      quietUntil: null,
      waiting: [{ ticket: 'T-0121', task: 'build', cause: 'seats' }],
      devServers: [{ port: 4302, ticket: 'T-0126' }],
    },
    autostart: true,
  };
}

function baseRun(): Omit<SessionRun, 'id' | 'ticketId' | 'persona' | 'worktreePath'> {
  return {
    phase: 'build',
    provider: 'claude-code',
    model: 'sonnet',
    state: 'running',
    pid: 19877,
    startedAt: today('08:33:09'),
    endedAt: null,
    lastActivity: minutesAgo(1),
    sessionRef: null,
    tokensIn: 0,
    cacheReadTokens: 0,
    tokensOut: 0,
    costUsd: null,
    turn: 'idle',
    turns: null,
    held: false,
    interactive: false,
    kind: 'run',
    workingDirectory: '',
    releaseAt: null,
    origin: 'chain',
    handoverMode: 'fresh',
    slot: null,
    grantClass: null,
    permission: null,
  };
}

function endedRun(index: number): SessionRun {
  const ids = ['T-0110', 'T-0112', 'T-0114', 'T-0115', 'T-0117', 'T-0118', 'T-0119'];
  const personas = ['ben', 'tessa', 'ralf', 'ben', 'tessa', 'ralf', 'ben'];
  const phases = ['build', 'test', 'review', 'build', 'test', 'review', 'build'];
  return {
    ...baseRun(),
    id: `R-20261107T08${String(10 + index).padStart(2, '0')}-e${index}00`,
    ticketId: ids[index] ?? 'T-0100',
    persona: personas[index] ?? null,
    phase: phases[index] ?? null,
    worktreePath: `E:\\projects\\drey-tickets\\_worktrees\\${ids[index] ?? 'T-0100'}`,
    state: index === 5 ? 'failed' : index === 3 ? 'stopped' : 'done',
    pid: null,
    endedAt: today('08:20:00'),
    turns: 4,
  };
}

export function demoRuns(): readonly SessionRun[] {
  const tessa: SessionRun = {
    ...baseRun(),
    id: 'R-20261107T0814-7f1a',
    ticketId: 'T-0126',
    persona: 'tessa',
    phase: 'test',
    provider: 'opencode',
    model: 'qwen3-coder',
    pid: 19410,
    startedAt: today('08:14:11'),
    lastActivity: minutesAgo(9),
    turn: 'idle',
    turns: 6,
    origin: 'drey:run-dialog',
    worktreePath: 'E:\\projects\\drey-tickets\\_worktrees\\T-0126',
    slot: { id: 'zai', label: 'z.ai' },
    grantClass: 'B',
  };
  const ben: SessionRun = {
    ...baseRun(),
    id: 'R-20261107T0833-c02e',
    ticketId: 'T-0121',
    persona: 'ben',
    lastActivity: minutesAgo(0),
    sessionRef: 'e4b9a7d3c02e71c0',
    tokensIn: 112_000,
    cacheReadTokens: 98_000,
    tokensOut: 4_100,
    costUsd: 0.61,
    turn: 'busy',
    turns: 3,
    worktreePath: 'E:\\projects\\drey-tickets\\_worktrees\\T-0121',
    slot: { id: 'claude-a', label: 'Claude A' },
    grantClass: 'B',
    permission: 'auto',
  };
  const oneToOne: SessionRun = {
    ...baseRun(),
    id: 'S-ben-1on1',
    ticketId: '1:1',
    persona: 'ben',
    phase: null,
    pid: 19102,
    startedAt: today('08:27:15'),
    lastActivity: minutesAgo(4),
    held: true,
    kind: '1:1',
    releaseAt: new Date(Date.parse(minutesAgo(4)) + 15 * 60_000).toISOString(),
    origin: 'drey:1:1',
    permission: 'read-only',
    worktreePath: 'E:\\projects\\drey-tickets',
  };
  // R12: the directory is explicit on every record — a run's worktree, the 1:1's tickets repository.
  return [tessa, ben, oneToOne, ...Array.from({ length: 7 }, (_, index) => endedRun(index))].map((run) => ({ ...run, workingDirectory: run.worktreePath }));
}

export function demoStream(): readonly StreamEvent[] {
  const at = (time: string): string => today(time);
  return [
    { ts: at('08:33:09'), kind: 'note', text: 'init · cwd E:\\projects\\drey-tickets\\_worktrees\\T-0121 · tools: Read, Edit, Bash, mcp__drey__vault_read, mcp__drey__vault_search, mcp__drey__tickets_read …' },
    { ts: at('08:33:10'), kind: 'note', text: 'you › [instruction, 9.8k tokens — open under Instruction]' },
    { ts: at('08:33:31'), kind: 'text', text: 'I will start with the failing test for the order reducer …' },
    { ts: at('08:33:32'), kind: 'tool', tool: 'Read', detail: 'ok', text: 'Read plugins/tickets/renderer/board/order.ts → 212 lines' },
    { ts: at('08:33:40'), kind: 'tool', tool: 'mcp__drey__vault_search', detail: 'ok', text: 'mcp__drey__vault_search {"query":"order reducer","vault":"notes"} → 3 hits' },
    { ts: at('08:33:41'), kind: 'tool', tool: 'mcp__drey__vault_write', detail: 'failed', text: 'mcp__drey__vault_write → Error: ben may not write vault "notes" (allowed: read)' },
    { ts: at('08:34:02'), kind: 'tool', tool: 'Edit', detail: 'ok', text: 'Edit plugins/tickets/renderer/board/order.spec.ts (+18 −0)' },
    { ts: at('08:34:55'), kind: 'tool', tool: 'Bash', detail: 'ok', text: 'Bash npm run test:plugin -- tickets -t "order" → exit 1 (1 failed)' },
    { ts: at('08:35:10'), kind: 'text', text: 'The test fails as intended; now the reducer.' },
    { ts: at('08:35:11'), kind: 'usage', turnUsage: { input: 41_000, cacheRead: 38_000, output: 1_400 } },
  ];
}

export const DEMO_INSTRUCTION = [
  'You are Ben, the build persona. Ticket T-0121: the order reducer drops entries',
  'when two columns share a phase. Write the failing test first, then the fix.',
  '',
  'Rules: stay inside the worktree, commit nothing, report what you changed.',
].join('\n');

export function demoLog(): readonly LogLine[] {
  const line = (time: string, message: string, level: LogLine['level'] = 'info', component = 'runner'): LogLine => ({
    at: today(time),
    level,
    component,
    message,
  });
  return [
    line('08:12:03', 'runner up, home C:\\Users\\puls\\.drey-engine\\fleet'),
    line('08:12:04', 'chain config from engine: vault drey-tickets, autopilot off', 'info', 'engine'),
    line('08:14:11', 'run R-…7f1a start T-0126 test · tessa · opencode/qwen3-coder · origin drey:run-dialog'),
    line('08:14:11', 'route T-0126 → z.ai/glm-5.3: class B, q 1.2, est $0.22 · filtered: kimi (no image input)'),
    line('08:14:12', 'mcp: run token minted, vault read-only (all), tickets tools', 'info', 'service'),
    line('08:21:40', 'run R-…7f1a turn 6 · 38k in (34k cached) · 1.2k out'),
    line('08:26:02', 'run R-…7f1a no output for 9 min', 'warn'),
    line('08:27:15', 'session S-ben-1on1 open · claude-code/sonnet · origin drey:crew-1on1'),
    line('08:31:50', 'session S-ben-1on1 idle, release in 11 min'),
    line('08:33:09', 'run R-…c02e start T-0121 build · ben · origin chain'),
    line('08:33:09', 'route T-0121 → claude-a/sonnet: class B, q 1.4, est $0.40'),
    line('08:33:10', 'mcp: vault_write refused — ben may not write vault "notes" (allowed: read)', 'error', 'service'),
    line('08:35:02', 'governor: heavy seat granted to T-0126 tests · 1 of 2', 'info', 'service'),
    line('08:36:40', 'tranche 4 of 10 runs · checkpoint in 6 runs'),
  ];
}
