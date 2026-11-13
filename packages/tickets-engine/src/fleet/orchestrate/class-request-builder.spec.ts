import { describe, expect, it } from 'vitest';
import type { PipelinePhase, TicketCard, TicketMeta } from '../../contracts/tickets';
import { parsePersonaFile } from '../../core/persona';
import type { CapabilityClass, PoolEntry } from '../protocol';
import { ClassRequestBuilder } from './class-request-builder';

const CLASSES: Readonly<Record<string, CapabilityClass>> = { opus: 'heavy', sonnet: 'standard', glm: 'standard', k2: 'light' };
const ORDER: readonly CapabilityClass[] = ['super heavy', 'heavy', 'standard', 'light'];
const lookup = {
  classOf: (entry: PoolEntry): CapabilityClass | null => (entry.model === null ? null : (CLASSES[entry.model] ?? null)),
  rankOf: (name: CapabilityClass): number => (ORDER.includes(name) ? ORDER.indexOf(name) : ORDER.length),
};
const builder = new ClassRequestBuilder(lookup);

const persona = (pool: string, extra = ''): ReturnType<typeof parsePersonaFile> =>
  parsePersonaFile('ben', `---\ntitle: Ben\nworker: claude-code\nmodels:\n  default: sonnet\n  pool: [${pool}]\nbudget: 5\n${extra}---\n`);
const card = (meta: Partial<TicketMeta> = {}): TicketCard => ({ id: 'T-0001', meta: { repo: null, ...meta } }) as unknown as TicketCard;
const phase = (minClass?: CapabilityClass): PipelinePhase => ({ id: 'plan', ...(minClass !== undefined ? { minClass } : {}) }) as PipelinePhase;

describe('ClassRequestBuilder — who asks for which class (req-170)', () => {
  it('unsized: the class of the persona\'s default model; the ledger inputs come from the ticket and the persona', () => {
    const request = builder.build({ card: card({ allowance: 2.5 }), phase: phase(), persona: persona('opus, sonnet, kimi/k2', 'allowed:\n  spend-above-allowance: true\n') });
    expect(request).toMatchObject({ class: 'standard', why: "ben's default class standard", provider: 'claude-code' });
    expect(request.pool).toEqual([{ provider: null, model: 'opus' }, { provider: null, model: 'sonnet' }, { provider: 'kimi', model: 'k2' }]);
    expect(request.ledger).toEqual({ allowance: 2.5, personaBudget: 5, spendAboveAllowance: true });
  });

  it('a size asks for its class: S → light, L → heavy', () => {
    expect(builder.build({ card: card({ size: 'S' }), phase: phase(), persona: persona('opus, sonnet, kimi/k2') })).toMatchObject({ class: 'light', why: 'size S → light' });
    expect(builder.build({ card: card({ size: 'L' }), phase: phase(), persona: persona('opus, sonnet') })).toMatchObject({ class: 'heavy', why: 'size L → heavy' });
  });

  it('the phase floor raises a lighter request, never lowers a stronger one', () => {
    expect(builder.build({ card: card({ size: 'S' }), phase: phase('standard'), persona: persona('opus, sonnet, kimi/k2') })).toMatchObject({ class: 'standard', why: 'size S → light, floor standard in plan' });
    expect(builder.build({ card: card({ size: 'L' }), phase: phase('standard'), persona: persona('opus, sonnet') })).toMatchObject({ class: 'heavy' });
  });

  it("a class the persona's pool does not hold is raised to the lightest stronger one it holds", () => {
    expect(builder.build({ card: card({ size: 'S' }), phase: phase(), persona: persona('opus, sonnet') })).toMatchObject({ class: 'standard', why: "size S → light, raised to standard, the lightest class ben's pool holds above light" });
    expect(builder.build({ card: card({ size: 'L' }), phase: phase(), persona: persona('sonnet') })).toMatchObject({ class: 'heavy' }); // nothing stronger: it stays heavy and waits on the configuration
  });

  it('a ticket pin wins: model: asks for that model alone, class: for exactly that class', () => {
    expect(builder.build({ card: card({ model: 'opus', size: 'S' }), phase: phase('standard'), persona: persona('sonnet') })).toMatchObject({ class: null, pool: [{ provider: null, model: 'opus' }], why: 'T-0001 pins model opus' });
    expect(builder.build({ card: card({ class: 'light' }), phase: phase('standard'), persona: persona('sonnet') })).toMatchObject({ class: 'light', why: 'T-0001 pins class light' });
  });

  it("req-178: the phase's and the ticket's needs ride merged; the step up is allowed unless a pin decides; the last slot is preferred", () => {
    const needy = { ...phase(), needs: { image: true, contextTokens: 100_000 } } as PipelinePhase;
    const request = builder.build({ card: card({ needs: { contextTokens: 200_000 } }), phase: needy, persona: persona('sonnet'), prefer: 'claude-b' });
    expect(request).toMatchObject({ needs: { image: true, contextTokens: 200_000 }, stepUp: true, prefer: 'claude-b' });
    expect(builder.build({ card: card(), phase: phase(), persona: persona('sonnet') })).not.toHaveProperty('needs');
    expect(builder.build({ card: card({ class: 'standard' }), phase: phase(), persona: persona('sonnet') }).stepUp).toBeUndefined();
    expect(builder.build({ card: card({ model: 'opus' }), phase: phase(), persona: persona('sonnet') }).stepUp).toBeUndefined();
  });

  it("req-258: the persona's own floor and needs win over the column's when its record names them", () => {
    const floored = persona('opus, sonnet, kimi/k2', 'min-class: A\n');
    expect(builder.build({ card: card({ size: 'S' }), phase: phase('standard'), persona: floored })).toMatchObject({ class: 'heavy', why: 'size S → light, floor heavy of ben' });
    const needy = { ...phase(), needs: { image: true } } as PipelinePhase;
    expect(builder.build({ card: card(), phase: needy, persona: persona('sonnet', 'needs: [tools]\n') }).needs).toEqual({ tools: true });
    expect(builder.build({ card: card(), phase: needy, persona: persona('sonnet') }).needs).toEqual({ image: true });
  });

  it('req-290: the request carries no profile, whatever the repository said', () => {
    expect(builder.build({ card: card(), phase: phase(), persona: persona('sonnet') })).not.toHaveProperty('profile');
  });
});
