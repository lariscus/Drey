/**
 * Renders the fully composed brief of every pipeline step and the crew
 * chat prompts with the engine's own composers (req-280): the step prompt
 * as its column template (no persona), the disciplines the engine appends,
 * fixed placeholder ticket facts. Writes one file per brief into the out
 * dir and prints a size table. Bundle with esbuild, then run it with `<outDir> [promptsDir]`
 * (scripts/render-composed-prompts.ts is a dev aid for prompt revisions, req-280).
 */
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { composeInstruction, composeScoutInstruction, type InstructionInput } from '../packages/tickets-engine/src/fleet/assignment';
import { loadDisciplineTexts } from '../packages/tickets-engine/src/fleet/discipline-texts';
import { loadShippedPrompts, stripPromptVersion } from '../packages/tickets-engine/src/core/default-prompts';
import { DEFAULT_FLEET_CAPS } from '../packages/tickets-engine/src/fleet/protocol-fleet-config';
import { loadCrewPrompts } from '../packages/tickets-engine/src/services/crew-prompts';

const SHIPPED_PROMPTS_DIR = path.resolve(process.argv[3] ?? 'packages/tickets-engine/prompts');
const PLAN = '### Goal\n\n<the plan body>\n\n### Acceptance criteria\n\n- [ ] `npm test`';

async function main(): Promise<void> {
  const out = process.argv[2] ?? 'composed-prompts';
  await fsp.mkdir(out, { recursive: true });
  const disciplines = await loadDisciplineTexts(SHIPPED_PROMPTS_DIR);
  const prompts = await loadShippedPrompts(SHIPPED_PROMPTS_DIR);
  const base = (prompt: string): InstructionInput => ({
    disciplines,
    ticketId: 'T-0001',
    title: 'Example ticket',
    repo: 'drey',
    branch: 't/T-0001',
    worktreePath: '/fleet/worktrees/T-0001',
    phase: 'building',
    description: '<the ticket description>',
    plan: PLAN,
    prompt,
    acceptance: ['npm test'],
    ticketFile: '/vault/tickets/50-build/T-0001.md',
    repoInstructions: null,
    diffStat: null,
    gateFailure: null,
    caps: DEFAULT_FLEET_CAPS,
  });
  const text = (ref: string): string => stripPromptVersion(prompts.get(ref) ?? '');
  const briefs: Record<string, string> = {
    'plan': composeInstruction(base(text('plan-default'))).text,
    'plan-interactive': composeInstruction({ ...base(text('plan-interactive-default')), interactive: 'plan' }).text,
    'build': composeInstruction(base(text('build-default'))).text,
    'review': composeInstruction({ ...base(text('review-default')), reviewCheckout: '/fleet/review/T-0001' }).text,
    'qa': composeInstruction({ ...base(text('qa-default')), personaId: 'tessa', personaRole: 'tester' }).text,
    'commit': composeInstruction(base(text('commit-default'))).text,
    'scout': composeScoutInstruction({
      disciplines,
      ticketId: 'T-0001',
      title: 'Example ticket',
      readGround: '/repos/drey',
      repoName: 'drey',
      ticketFile: '/vault/tickets/20-prioritized/T-0001.md',
      phase: 'prioritized',
      description: '<the ticket description>',
      plan: null,
      prompt: text('scout-default'),
      repoInstructions: null,
      personaId: 'scout',
    }).text,
  };
  const crew = await loadCrewPrompts(SHIPPED_PROMPTS_DIR);
  for (const name of ['mission', 'shape', 'flow', 'aggregator'] as const) {
    briefs[`crew-${name}`] = crew[name];
  }
  const rows: string[] = [];
  for (const [name, brief] of Object.entries(briefs)) {
    await fsp.writeFile(path.join(out, `${name}.txt`), `${brief}\n`, 'utf8');
    rows.push(`${name.padEnd(18)} ${String(Buffer.byteLength(brief, 'utf8')).padStart(6)} bytes`);
  }
  console.log(rows.join('\n'));
}

void main();
