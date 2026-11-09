import type { SkillView } from '../../../../packages/tickets-engine/src/contracts/skills';

const skill = (name: string, origin: 'own' | 'shared', on: boolean, tokens: number): SkillView => ({
  name,
  description: `${name} skill`,
  origin,
  on,
  overridesShared: false,
  legacy: false,
  size: tokens * 4,
  tokens,
  files: 1,
  allowedTools: [],
  license: null,
  declaredName: null,
});

/** The skills of both folders as the mockup's Ben has them: two on from the shared pool, his own, and one shared skill off. */
export function skillsOf(): SkillView[] {
  return [skill('tdd', 'own', true, 240), skill('go-conventions', 'shared', true, 310), skill('diff-review', 'shared', false, 400)];
}
