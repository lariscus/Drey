import { describe, expect, it } from 'vitest';
import { parsePersonaFile, type Persona } from '../core/persona';
import type { EngineVault } from './host';
import { MissionPersonaPrompt } from './mission-persona-prompt';

/** req-269: the reader of Mission Control's persona prompt — from disk on every call, never throwing. */

const VAULT = { id: 'v', path: '/vault' } as EngineVault;
const persona = (id: string, kind: string): Persona => parsePersonaFile(id, `---\ntitle: ${id}\nkind: ${kind}\n---\n`);

function reader(personas: readonly Persona[], files: Record<string, string>, vault: EngineVault | null = VAULT): MissionPersonaPrompt {
  return new MissionPersonaPrompt(
    { detect: async () => vault, listPersonas: async () => personas },
    {
      read: async (_vault, path) => {
        const text = files[path];
        if (text === undefined) {
          throw new Error(`ENOENT ${path}`);
        }
        return text;
      },
    },
  );
}

describe('MissionPersonaPrompt (req-269)', () => {
  it('reads the mission persona\'s prompt.md, folded to LF and trimmed', async () => {
    const text = await reader([persona('ben', 'agent'), persona('pia', 'mission')], { 'tickets/_meta/personas/pia/prompt.md': '\r\n## Who Pia is\r\n\r\nShe steers.\r\n' }).text();
    expect(text).toBe('## Who Pia is\n\nShe steers.');
  });

  it('takes the first mission persona in the crew\'s order, whatever its id', async () => {
    const files = { 'tickets/_meta/personas/mara/prompt.md': 'Mara.', 'tickets/_meta/personas/pia/prompt.md': 'Pia.' };
    expect(await reader([persona('mara', 'mission'), persona('pia', 'mission')], files).text()).toBe('Mara.');
  });

  it('is null without a vault, without a mission persona, without a prompt.md or with an empty one', async () => {
    expect(await reader([persona('pia', 'mission')], { 'tickets/_meta/personas/pia/prompt.md': 'Pia.' }, null).text()).toBeNull();
    expect(await reader([persona('ben', 'agent'), persona('you', 'human')], {}).text()).toBeNull();
    expect(await reader([persona('pia', 'mission')], {}).text()).toBeNull();
    expect(await reader([persona('pia', 'mission')], { 'tickets/_meta/personas/pia/prompt.md': '  \n' }).text()).toBeNull();
  });

  it('never throws when the board fails', async () => {
    const broken = new MissionPersonaPrompt({ detect: async () => VAULT, listPersonas: () => Promise.reject(new Error('boom')) }, { read: async () => '' });
    expect(await broken.text()).toBeNull();
    expect(await broken.model()).toBeNull();
  });
});

describe('MissionPersonaPrompt — memory, skills and the pinned model (req-293, req-294, req-296)', () => {
  const pia = (frontmatter: string): Persona => parsePersonaFile('pia', `---\ntitle: Pia\nkind: mission\n${frontmatter}---\n`);

  it('carries her memory slice and her enabled skills after the instructions, in that order', async () => {
    const files = {
      'tickets/_meta/personas/pia/prompt.md': 'Pia steers.',
      'tickets/_meta/personas/pia/memory.md': '- Answers first.\n',
      'tickets/_meta/personas/pia/skills/board-triage/SKILL.md': '---\nname: board-triage\n---\nSort the inbox by value.\n',
      'tickets/_meta/skills/release-notes/SKILL.md': '---\nname: release-notes\n---\nWrite the notes.\n',
    };
    const text = (await reader([pia('skills: [board-triage]\n')], files).text())!;
    expect(text.startsWith('Pia steers.\n\n## Memory')).toBe(true);
    expect(text).toContain('- Answers first.');
    expect(text).toContain('## Skills');
    expect(text).toContain('### board-triage\n\nSort the inbox by value.');
    expect(text).not.toContain('release-notes');
    expect(text.indexOf('## Memory')).toBeLessThan(text.indexOf('## Skills'));
  });

  it('speaks from memory or skills alone when prompt.md is empty', async () => {
    const text = await reader([pia('')], { 'tickets/_meta/personas/pia/memory.md': '- Answers first.\n' }).text();
    expect(text).toContain('## Memory');
  });

  it('reads her pinned model; none or blank is null (the assistant\'s own)', async () => {
    expect(await reader([pia('model: "glm-4.7-flash"\n')], {}).model()).toBe('glm-4.7-flash');
    expect(await reader([pia('')], {}).model()).toBeNull();
    expect(await reader([pia('model: "  "\n')], {}).model()).toBeNull();
    expect(await reader([persona('ben', 'agent')], {}).model()).toBeNull();
  });
});
