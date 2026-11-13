import { addablePersonasOf } from './flow.model';
import type { McFlow } from '../api/dto';

const flowOf = (personas: McFlow['personas']): McFlow => ({ personas }) as unknown as McFlow;
const p = (id: string, kind: 'agent' | 'human' | 'mission' = 'agent'): McFlow['personas'][number] => ({ id, kind, title: id, color: '', model: '' });

describe('the persona pickers in the crew order (req-273)', () => {
  it('lists agents as order: lists them, Mission Control next, You last', () => {
    const flow = flowOf([p('you', 'human'), p('mara', 'mission'), p('ben'), p('ralf'), p('tessa')]);
    expect(addablePersonasOf(flow, ['tessa', 'ben']).map((x) => x.id)).toEqual(['tessa', 'ben', 'ralf', 'mara', 'you']);
  });

  it('keeps the desk order without a crew order', () => {
    const flow = flowOf([p('ben'), p('you', 'human'), p('ralf')]);
    expect(addablePersonasOf(flow).map((x) => x.id)).toEqual(['ben', 'ralf', 'you']);
  });
});
