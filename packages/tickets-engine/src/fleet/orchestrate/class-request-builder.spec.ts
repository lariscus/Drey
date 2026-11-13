import { describe, expect, it } from 'vitest';
import type { PipelinePhase, TicketCard, TicketMeta } from '../../contracts/tickets';
import { parsePersonaFile } from '../../core/persona';
import type { CapabilityClass, PoolEntry } from '../protocol';
import { ClassRequestBuilder } from './class-request-builder';

const CLASSES: Readonly<Record<string, CapabilityClass>> = { opus: 'A', sonnet: 'B', glm: 'B', k2: 'C' };
const lookup = { classOf: (entry: PoolEntry): CapabilityClass | null => (entry.model === null ? null : (CLASSES[entry.model] ?? null)) };
const builder = new ClassRequestBuilder(lookup);

const persona = (pool: string, extra = ''): ReturnType<typeof parsePersonaFile> =>
  parsePersonaFile('ben', `---\ntitle: Ben\nworker: claude-code\nmodels:\n  default: sonnet\n  pool: [${pool}]\nbudget: 5\n${extra}---\n`);
const card = (meta: Partial<TicketMeta> = {}): TicketCard => ({ id: 'T-0001', meta: { repo: null, ...meta } }) as unknown as TicketCard;
const phase = (minClass?: CapabilityClass): PipelinePhase => ({ id: 'plan', ...(minClass !== undefined ? { minClass } : {}) }) as PipelinePhase;

describe('ClassRequestBuilder — who asks for which class (req-170)', () => {
  it('unsized: the class of the persona\'s default model; the ledger inputs come from the ticket and the persona', () => {
    const request = builder.build({ card: card({ allowance: 2.5 }), phase: phase(), persona: persona('opus, sonnet, kimi/k2', 'allowed:\n  spend-above-allowance: true\n') });
    expect(request).toMatchObject({ class: 'B', why: "ben's default class B", provider: 'claude-code' });
    expect(request.pool).toEqual([{ provider: null, model: 'opus' }, { provider: null, model: 'sonnet' }, { provider: 'kimi', model: 'k2' }]);
    expect(request.ledger).toEqual({ allowance: 2.5, personaBudget: 5, spendAboveAllowance: true });
  });

  it('a size asks for its class: S → C, L → A', () => {
    expect(builder.build({ card: card({ size: 'S' }), phase: phase(), persona: persona('opus, sonnet, kimi/k2') })).toMatchObject({ class: 'C', why: 'size S → C' });
    expect(builder.build({ card: card({ size: 'L' }), phase: phase(), persona: persona('opus, sonnet') })).toMatchObject({ class: 'A', why: 'size L → A' });
  });

  it('the phase floor raises a lighter request, never lowers a stronger one', () => {
    expect(builder.build({ card: card({ size: 'S' }), phase: phase('B'), persona: persona('opus, sonnet, kimi/k2') })).toMatchObject({ class: 'B', why: 'size S → C, floor B in plan' });
    expect(builder.build({ card: card({ size: 'L' }), phase: phase('B'), persona: persona('opus, sonnet') })).toMatchObject({ class: 'A' });
  });

  it("a class the persona's pool does not hold is raised to the lightest stronger one it holds", () => {
    expect(builder.build({ card: card({ size: 'S' }), phase: phase(), persona: persona('opus, sonnet') })).toMatchObject({ class: 'B', why: "size S → C, raised to B, the lightest class ben's pool holds above C" });
    expect(builder.build({ card: card({ size: 'L' }), phase: phase(), persona: persona('sonnet') })).toMatchObject({ class: 'A' }); // nothing stronger: it stays A and waits on the configuration
  });

  it('a ticket pin wins: model: asks for that model alone, class: for exactly that class', () => {
    expect(builder.build({ card: card({ model: 'opus', size: 'S' }), phase: phase('B'), persona: persona('sonnet') })).toMatchObject({ class: null, pool: [{ provider: null, model: 'opus' }], why: 'T-0001 pins model opus' });
    expect(builder.build({ card: card({ class: 'C' }), phase: phase('B'), persona: persona('sonnet') })).toMatchObject({ class: 'C', why: 'T-0001 pins class C' });
  });

  it("req-178: the phase's and the ticket's needs ride merged; the step up is allowed unless a pin decides; the last slot is preferred", () => {
    const needy = { ...phase(), needs: { image: true, contextTokens: 100_000 } } as PipelinePhase;
    const request = builder.build({ card: card({ needs: { contextTokens: 200_000 } }), phase: needy, persona: persona('sonnet'), prefer: 'claude-b' });
    expect(request).toMatchObject({ needs: { image: true, contextTokens: 200_000 }, stepUp: true, prefer: 'claude-b' });
    expect(builder.build({ card: card(), phase: phase(), persona: persona('sonnet') })).not.toHaveProperty('needs');
    expect(builder.build({ card: card({ class: 'B' }), phase: phase(), persona: persona('sonnet') }).stepUp).toBeUndefined();
    expect(builder.build({ card: card({ model: 'opus' }), phase: phase(), persona: persona('sonnet') }).stepUp).toBeUndefined();
  });

  it("req-258: the persona's own floor and needs win over the column's when its record names them", () => {
    const floored = persona('opus, sonnet, kimi/k2', 'min-class: A\n');
    expect(builder.build({ card: card({ size: 'S' }), phase: phase('B'), persona: floored })).toMatchObject({ class: 'A', why: 'size S → C, floor A of ben' });
    const needy = { ...phase(), needs: { image: true } } as PipelinePhase;
    expect(builder.build({ card: card(), phase: needy, persona: persona('sonnet', 'needs: [tools]\n') }).needs).toEqual({ tools: true });
    expect(builder.build({ card: card(), phase: needy, persona: persona('sonnet') }).needs).toEqual({ image: true });
  });

  it('req-290: the request carries no profile, whatever the repository said', () => {
    expect(builder.build({ card: card(), phase: phase(), persona: persona('sonnet') })).not.toHaveProperty('profile');
  });
});
