import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadShippedPrompts } from './default-prompts';
import { CREW_STEPS, DEFAULT_CREW_IDS, seededPersonaText, seededPromptText, shippedPersonaOf } from './default-crew';
import { parsePersonaFile } from './persona';

const DIR = path.join(__dirname, '..', '..', 'personas');
const file = (id: string, name: string): Promise<string> => fsp.readFile(path.join(DIR, id, name), 'utf8');
/** The four agents of decision D7; Pia (req-269) is Mission Control's persona and has a block of her own. */
const AGENT_IDS = DEFAULT_CREW_IDS.filter((id) => id !== 'pia');
type Shipped = Exclude<ReturnType<typeof shippedPersonaOf>, string>;

describe('the shipped default crew files (req-256)', () => {
  it('ships Pia first, then the four ids of decision D7, one folder each', async () => {
    expect(DEFAULT_CREW_IDS).toEqual(['pia', 'paul', 'ben', 'ralf', 'tessa']);
    expect((await fsp.readdir(DIR)).sort()).toEqual([...DEFAULT_CREW_IDS].sort());
    for (const id of DEFAULT_CREW_IDS) {
      expect((await fsp.readdir(path.join(DIR, id))).sort()).toEqual(['persona.md', 'prompt.md']);
    }
  });

  it('are LF and newline-terminated, byte for byte as the repo holds them', async () => {
    for (const id of DEFAULT_CREW_IDS) {
      for (const name of ['persona.md', 'prompt.md']) {
        const text = await file(id, name);
        expect(text, `${id}/${name}`).not.toContain('\r');
        expect(text.endsWith('\n'), `${id}/${name}`).toBe(true);
      }
    }
  });

  it('read as planner, builder, reviewer and tester, each with a summary, a colour of its own and no skills', async () => {
    const personas = await Promise.all(AGENT_IDS.map(async (id) => parsePersonaFile(id, await file(id, 'persona.md'))));
    expect(personas.map((p) => [p.title, p.role])).toEqual([['Paul', 'planner'], ['Ben', 'builder'], ['Ralf', 'reviewer'], ['Tessa', 'tester']]);
    const pia = parsePersonaFile('pia', await file('pia', 'persona.md'));
    expect(new Set([...personas, pia].map((p) => p.color)).size).toBe(5);
    for (const persona of personas) {
      expect(persona.kind).toBe('agent');
      expect(persona.summary.length, persona.id).toBeGreaterThan(20);
      expect(persona.summary.length, persona.id).toBeLessThanOrEqual(200);
      expect(persona.skills).toEqual([]);
      expect(persona.color).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('keep worker and models out of persona.md: the vault decides them at seeding', async () => {
    for (const id of DEFAULT_CREW_IDS) {
      const text = await file(id, 'persona.md');
      expect(text, id).not.toMatch(/^worker:/m);
      expect(text, id).not.toMatch(/^models:/m);
      expect(text.split('---').length, `${id}: frontmatter only, nothing below the fence`).toBe(3);
      expect(text.split('---')[2]!.trim()).toBe('');
    }
  });

  it('open prompt.md with the "who it is" section (R11: the prompt is the persona), then how it works — character only, the step owns "done" (req-280, D6)', async () => {
    for (const id of AGENT_IDS) {
      const title = parsePersonaFile(id, await file(id, 'persona.md')).title;
      const text = await file(id, 'prompt.md');
      expect(text.startsWith(`## Who ${title} is\n`), id).toBe(true);
      expect(text, id).toContain(`## How ${title} works`);
      expect(text, id).not.toContain('## What done means');
      expect(text, id).not.toContain('drey-prompt-version');
    }
  });

  it('are the personas shippedPersonaOf accepts, and it refuses a file that is not a crew member', async () => {
    for (const id of DEFAULT_CREW_IDS) {
      expect(shippedPersonaOf(id, await file(id, 'persona.md'), await file(id, 'prompt.md'))).toMatchObject({ id });
    }
    expect(shippedPersonaOf('x', '---\ntitle: X\nrole: custom\n---\n', '## Who X is\n')).toMatch(/role must be/);
    expect(shippedPersonaOf('x', '---\ntitle: X\nkind: human\nrole: builder\n---\n', '## Who X is\n')).toMatch(/role must be/);
    expect(shippedPersonaOf('x', '---\ntitle: X\nrole: builder\n---\n', 'Just text.\n')).toMatch(/must open with "## Who X is"/);
    expect(shippedPersonaOf('x', '---\ntitle: X\nkind: mission\nrole: custom\n---\n', '## Who X is\n')).toMatchObject({ id: 'x' });
  });
});

describe('Pia, Mission Control\'s persona (req-269)', () => {
  it('is kind mission, role custom, with her summary and no skills', async () => {
    const pia = parsePersonaFile('pia', await file('pia', 'persona.md'));
    expect(pia).toMatchObject({ kind: 'mission', title: 'Pia', role: 'custom', skills: [] });
    expect(pia.summary).toBe("Mission Control: the owner's one contact — steers the board and the crew; every change is a card the owner confirms.");
    expect(pia.color).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('opens prompt.md with who she is, then how the owner works with her', async () => {
    const text = await file('pia', 'prompt.md');
    expect(text.startsWith('## Who Pia is\n\nPia is Mission Control: the owner\'s one contact for the board and the crew.')).toBe(true);
    expect(text).toContain('\n## How the owner works with Pia\n\n- She answers briefly and plainly');
    expect(text).not.toContain('drey-prompt-version');
  });

  it('is seeded as shipped: no step below her prompt, no worker and no models in her record', async () => {
    const pia = shippedPersonaOf('pia', await file('pia', 'persona.md'), await file('pia', 'prompt.md')) as Shipped;
    expect(seededPromptText(pia, await loadShippedPrompts())).toEqual({ text: pia.who, stepMissing: false });
    const record = seededPersonaText(pia, 'claude-code', { default: 'm1', pool: ['m1'] });
    expect(record).toContain('kind: mission');
    expect(record).not.toMatch(/^worker:/m);
    expect(record).not.toMatch(/^models:/m);
    expect(parsePersonaFile('pia', record)).toMatchObject({ kind: 'mission', title: 'Pia', summary: pia.persona.summary, color: pia.persona.color });
  });
});

describe('what is seeded from them', () => {
  it('writes persona.md with the vault worker and the models it is given, the shipped record otherwise unchanged', async () => {
    const ben = shippedPersonaOf('ben', await file('ben', 'persona.md'), await file('ben', 'prompt.md')) as Exclude<ReturnType<typeof shippedPersonaOf>, string>;
    const text = seededPersonaText(ben, 'claude-code', { default: 'm1', pool: ['m1', 'm2'] });
    expect(text).toContain('worker: claude-code');
    expect(text).toContain('  default: m1\n  pool: [m1, m2]');
    expect(parsePersonaFile('ben', text)).toMatchObject({ title: 'Ben', role: 'builder', summary: ben.persona.summary, color: ben.persona.color, skills: [] });
    expect(seededPersonaText(ben, 'opencode', null)).toContain(`  default: ${ben.persona.models.default}`);
  });

  it('puts the role\'s shipped step under the character, one prompt that works as the run\'s instruction base', async () => {
    const steps = await loadShippedPrompts();
    for (const id of AGENT_IDS) {
      const shipped = shippedPersonaOf(id, await file(id, 'persona.md'), await file(id, 'prompt.md')) as Exclude<ReturnType<typeof shippedPersonaOf>, string>;
      const step = CREW_STEPS[shipped.persona.role]!;
      const out = seededPromptText(shipped, steps);
      expect(out.stepMissing).toBe(false);
      expect(out.text.startsWith(shipped.who)).toBe(true);
      expect(out.text).toContain(`## The ${step.name} step\n\n`);
      expect(out.text).toContain(steps.get(step.ref)!.split('\n').slice(1).join('\n').trim());
      expect(out.text.endsWith('\n')).toBe(true);
    }
  });

  it('seeds the character alone, and says so, when the package holds no step prompt for the role', async () => {
    const paul = shippedPersonaOf('paul', await file('paul', 'persona.md'), await file('paul', 'prompt.md')) as Exclude<ReturnType<typeof shippedPersonaOf>, string>;
    expect(seededPromptText(paul, new Map())).toEqual({ text: paul.who, stepMissing: true });
  });
});
