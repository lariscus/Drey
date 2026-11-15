import { describe, expect, it } from 'vitest';
import type { TicketCard, TicketMeta } from '../../contracts/tickets';
import { parsePersonaFile } from '../../core/persona';
import type { CapabilityClass, PoolEntry } from '../protocol';
import { ClassRequestBuilder } from './class-request-builder';

const CLASSES: Readonly<Record<string, CapabilityClass>> = { opus: 'heavy', sonnet: 'standard', 'glm-5.3': 'standard', k2: 'light' };
const ORDER: readonly CapabilityClass[] = ['super heavy', 'heavy', 'standard', 'light'];
const ENTRIES: readonly PoolEntry[] = [
  { provider: 'claude-code', model: 'opus' },
  { provider: 'claude-code', model: 'sonnet' },
  { provider: 'opencode', model: 'glm-5.3' },
  { provider: 'kimi', model: 'k2' },
];
const lookup = {
  classOf: (entry: PoolEntry): CapabilityClass | null => (entry.model === null ? null : (CLASSES[entry.model] ?? null)),
  rankOf: (name: CapabilityClass): number => (ORDER.includes(name) ? ORDER.indexOf(name) : ORDER.length),
  entries: (): readonly PoolEntry[] => ENTRIES,
};
const builder = new ClassRequestBuilder(lookup);

const persona = (cls: string, extra = ''): ReturnType<typeof parsePersonaFile> => parsePersonaFile('ben', `---\ntitle: Ben\nclass: ${cls}\nbudget: 5\n${extra}---\n`);
const card = (meta: Partial<TicketMeta> = {}): TicketCard => ({ id: 'T-0001', meta: { repo: null, ...meta } }) as unknown as TicketCard;

describe('ClassRequestBuilder — the persona names its class (req-170, Persona v3 req-288)', () => {
  it("asks for the persona's class over every model the router may use; the ledger inputs come from the ticket and the persona", () => {
    const request = builder.build({ card: card({ allowance: 2.5 }), persona: persona('standard', 'allowed:\n  spend-above-allowance: true\n') });
    expect(request).toMatchObject({ class: 'standard', why: "ben's class standard", provider: 'claude-code', stepUp: true });
    expect(request.pool).toEqual(ENTRIES);
    expect(request.ledger).toEqual({ allowance: 2.5, personaBudget: 5, spendAboveAllowance: true });
  });

  it('a size raises the class, never lowers it: L lifts a standard persona to heavy, S leaves it standard', () => {
    expect(builder.build({ card: card({ size: 'L' }), persona: persona('standard') })).toMatchObject({ class: 'heavy', why: "ben's class standard, raised to heavy (size L → heavy)" });
    expect(builder.build({ card: card({ size: 'S' }), persona: persona('standard') })).toMatchObject({ class: 'standard', why: "ben's class standard" });
  });

  it("the ticket's class raises too, never lowers", () => {
    expect(builder.build({ card: card({ class: 'super heavy' }), persona: persona('heavy') })).toMatchObject({ class: 'super heavy' });
    expect(builder.build({ card: card({ class: 'light' }), persona: persona('heavy') })).toMatchObject({ class: 'heavy' });
  });

  it('a pinned model runs alone while nothing raised the class; a raise takes the next free model of the raised class', () => {
    const pinned = persona('heavy', 'model: "claude-code/opus"\n');
    expect(builder.build({ card: card(), persona: pinned })).toMatchObject({ class: null, pool: [{ provider: 'claude-code', model: 'opus' }], why: 'ben pins model claude-code/opus' });
    expect(builder.build({ card: card(), persona: pinned }).stepUp).toBeUndefined();
    const raised = builder.build({ card: card({ class: 'super heavy' }), persona: pinned });
    expect(raised).toMatchObject({ class: 'super heavy', pool: ENTRIES, stepUp: true });
  });

  it("a ticket's pinned model wins over everything", () => {
    expect(builder.build({ card: card({ model: 'k2', size: 'L' }), persona: persona('heavy') })).toMatchObject({ class: null, pool: [{ provider: null, model: 'k2' }], why: 'T-0001 pins model k2' });
  });

  it('an unmigrated v2 record asks by the migration rule: the class of its old default', () => {
    const v2 = parsePersonaFile('ben', '---\ntitle: Ben\nworker: claude-code\nmodels:\n  default: sonnet\n  pool: [opus, sonnet]\nmin-class: A\n---\n');
    expect(builder.build({ card: card(), persona: v2 })).toMatchObject({ class: 'heavy', pool: ENTRIES });
    const single = parsePersonaFile('ben', '---\ntitle: Ben\nworker: opencode\nmodels:\n  default: glm-5.3\n  pool: [glm-5.3]\n---\n');
    expect(builder.build({ card: card(), persona: single })).toMatchObject({ class: null, pool: [{ provider: 'opencode', model: 'glm-5.3' }] });
  });

  it("req-178/258: the persona's needs and the ticket's merge; the last slot is preferred", () => {
    expect(builder.build({ card: card({ needs: { contextTokens: 200_000 } }), persona: persona('standard', 'needs: [image, context-100k]\n'), prefer: 'claude-b' })).toMatchObject({ needs: { image: true, contextTokens: 200_000 }, prefer: 'claude-b' });
    expect(builder.build({ card: card(), persona: persona('standard', 'needs: [tools]\n') }).needs).toEqual({ tools: true });
    expect(builder.build({ card: card(), persona: persona('standard') })).not.toHaveProperty('needs');
  });

  it('a machine without a table runs the pin; a persona without one waits on the configuration (an empty pool)', () => {
    const bare = new ClassRequestBuilder({ ...lookup, entries: () => [] });
    expect(bare.build({ card: card({ size: 'L' }), persona: persona('standard', 'model: "kimi/k2"\n') }).pool).toEqual([{ provider: 'kimi', model: 'k2' }]);
    expect(bare.build({ card: card(), persona: persona('standard') })).toMatchObject({ pool: [], provider: 'claude-code' });
  });

  it('req-290: the request carries no profile', () => {
    expect(builder.build({ card: card(), persona: persona('standard') })).not.toHaveProperty('profile');
  });
});
