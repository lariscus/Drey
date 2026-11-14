import type { SkillLibraryData, SkillLibraryRow } from '../../../../packages/tickets-engine/src/contracts/skill-library';

/** Board 7o's library: two GitHub sources, shared, fetched and own skills, the seeded crew as users. */

const BEN = { id: 'ben', title: 'Ben', color: '#8ecbef' };
const RALF = { id: 'ralf', title: 'Ralf', color: '#bfe3cd' };
const PAUL = { id: 'paul', title: 'Paul', color: '#f2d3e2' };
const TESSA = { id: 'tessa', title: 'Tessa', color: '#f2cfae' };

const ACME = { repo: 'github.com/acme/skills', path: '', ref: 'v1.4', commit: 'a'.repeat(40) };
const ANTHROPIC = { repo: 'github.com/anthropics/skills', path: '', ref: 'main', commit: 'b'.repeat(40) };

const row = (name: string, tokens: number, usedBy: SkillLibraryRow['usedBy'], source: SkillLibraryRow['source'] = null, persona: string | null = null): SkillLibraryRow => ({
  name,
  description: `${name} skill`,
  origin: persona === null ? 'shared' : 'own',
  persona,
  source,
  updateAvailable: source === ACME ? 'v1.5' : null,
  tokens,
  size: tokens * 4,
  usedBy,
});

export const library: SkillLibraryData = {
  sources: [
    { ...ACME, id: 'github.com/acme/skills', skills: ['angular-standalone', 'playwright-e2e'], fetched: new Date().toISOString(), updateAvailable: 'v1.5', checked: new Date().toISOString(), checkError: null },
    { ...ANTHROPIC, id: 'github.com/anthropics/skills', skills: ['security-review'], fetched: '2026-01-02T08:00:00.000Z', updateAvailable: null, checked: null, checkError: null },
  ],
  skills: [
    row('adr-writing', 610, [PAUL]),
    row('angular-standalone', 730, [BEN], ACME),
    row('commit-messages', 260, [BEN, RALF, PAUL, TESSA]),
    row('go-conventions', 880, [RALF]),
    row('playwright-e2e', 1240, [BEN, TESSA], ACME),
    row('release-notes', 340, [], null, 'paul'),
    row('security-review', 1500, [BEN, RALF], ANTHROPIC),
    row('test-first', 420, [BEN, RALF, PAUL]),
  ],
};
