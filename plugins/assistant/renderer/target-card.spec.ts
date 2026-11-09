// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type { ConversationCard } from '../../../shared/plugin-api/renderer';
import { isRichCard, proposalNode } from './target-card';

const targets = () => ({ busy: () => false, act: vi.fn(() => Promise.resolve()) });

describe('the proposal card', () => {
  it('draws a card without the 1.55 fields exactly as before: text, note, buttons', () => {
    const card: ConversationCard = {
      id: 'c1',
      kind: 'card',
      text: 'Split it?',
      note: 'Decided.',
      actions: [{ id: 'go', label: 'Go', tone: 'primary' }, { id: 'no', label: 'No' }],
    };
    const node = proposalNode(targets(), card);
    expect(isRichCard(card)).toBe(false);
    expect(node.className).toBe('target-card');
    expect([...node.children].map((child) => child.className)).toEqual(['target-card-text', 'target-card-note', 'target-card-actions']);
  });

  it('draws the title with its dot, the grid, the rows, the note, the buttons and the meta line in that order', () => {
    const act = vi.fn(() => Promise.resolve());
    const card: ConversationCard = {
      id: 'c2',
      kind: 'card',
      title: 'Checkpoint',
      dot: 'attention',
      text: '',
      metrics: [
        { label: 'Gate rate', value: '7 of 8', sub: 'green', inline: true },
        { label: 'Cost per run', value: '$0.41', sub: 'median · $1.20 max' },
      ],
      rows: [{ text: 'T-0119 · build', dot: 'negative' }],
      note: 'Autopilot paused',
      actions: [{ id: 'release', label: 'Release', tone: 'primary' }],
      meta: 'Mission Control · 14:02',
    };
    const node = proposalNode({ busy: () => false, act }, card);
    expect(node.classList.contains('target-card-rich')).toBe(true);
    expect([...node.children].map((child) => child.className)).toEqual([
      'target-card-title',
      'target-card-metrics',
      'target-card-rows',
      'target-card-note',
      'target-card-actions',
      'target-card-meta',
    ]);
    expect(node.querySelector('.target-card-dot')!.getAttribute('data-tone')).toBe('attention');
    const [gate, cost] = [...node.querySelectorAll('.target-card-metric')];
    expect(gate!.querySelector('.target-card-metric-line')!.textContent).toBe('7 of 8green');
    expect(cost!.querySelector('.target-card-metric-line')!.textContent).toBe('$0.41');
    expect(cost!.lastElementChild!.textContent).toBe('median · $1.20 max');
    expect(node.querySelector('.target-card-row .target-card-dot')!.getAttribute('data-tone')).toBe('negative');
    node.querySelector<HTMLButtonElement>('.target-card-btn')!.click();
    expect(act).toHaveBeenCalledWith('c2', 'release');
  });

  it('keeps an early-stop body between the title and the rows', () => {
    const node = proposalNode(targets(), { id: 'c3', kind: 'card', title: 'Stopped early', dot: 'negative', text: '3 of 6 gates were red.', rows: [{ text: 'T-0124', dot: 'negative' }] });
    expect([...node.children].map((child) => child.className)).toEqual(['target-card-title', 'target-card-text', 'target-card-rows']);
  });

  it('draws the 1.56 chips under the body, before the buttons (board 10u: the quota stop, the burn rate)', () => {
    const card: ConversationCard = {
      id: 'c4',
      kind: 'card',
      title: 'Burn rate reached · 20 % of the week today',
      dot: 'attention',
      text: 'Nothing new starts until 00:00. Running steps finish.',
      chips: ['spent 21 %', 'resumes 00:00'],
      actions: [{ id: 'wait', label: 'Wait', tone: 'primary' }, { id: 'allow_once', label: 'Allow today once' }],
      meta: 'Mission Control · 22:40',
    };
    const node = proposalNode(targets(), card);
    expect(isRichCard({ id: 'x', kind: 'card', text: 'x', chips: ['a'] })).toBe(true);
    expect([...node.children].map((child) => child.className)).toEqual(['target-card-title', 'target-card-text', 'target-card-chips', 'target-card-actions', 'target-card-meta']);
    expect([...node.querySelectorAll('.target-card-chip')].map((chip) => chip.textContent)).toEqual(['spent 21 %', 'resumes 00:00']);
  });
});
