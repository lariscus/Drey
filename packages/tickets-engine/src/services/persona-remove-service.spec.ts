import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parsePersonaFile } from '../core/persona';
import type { PersonaPins } from '../core/persona-removal';
import { TicketsGit } from '../core/tickets-git';
import type { EngineVault } from './host';
import { PersonaRemoveService, type PersonaRemoveDeps } from './persona-remove-service';

/**
 * req-261 against a real git repository: a removal is one commit of exactly
 * the persona's folder (its own skills included), the ticket history and the
 * chat files stay, and every refusal leaves the folder and the history alone.
 */

let dir = '';
const BEN = 'tickets/_meta/personas/ben';
const git = (...args: string[]): string => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
const write = (rel: string, text: string): void => {
  mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  writeFileSync(path.join(dir, rel), text);
};
const persona = (title: string, kind = 'agent'): string => `---\ntitle: ${title}\nkind: ${kind}\nworker: claude-code\nmodels:\n  default: opus\n---\n`;

interface Rig {
  readonly service: PersonaRemoveService;
  readonly announce: ReturnType<typeof vi.fn>;
}

function rig(options: { runs?: readonly { persona: string | null; state: string }[]; pins?: PersonaPins; noRunner?: boolean; git?: boolean } = {}): Rig {
  const vault: EngineVault = { id: 'v', name: 'tickets', path: dir, exists: true, active: true };
  const announce = vi.fn();
  const deps: PersonaRemoveDeps = {
    board: {
      detect: async () => vault,
      loadPersona: async (_v, id) => {
        const file = path.join(dir, 'tickets/_meta/personas', id, 'persona.md');
        return existsSync(file) ? parsePersonaFile(id, readFileSync(file, 'utf8')) : null;
      },
    },
    fleet: { runs: options.noRunner === true ? () => Promise.reject(new Error('the runner is down')) : async () => options.runs ?? [] },
    pins: { pinsOf: async () => options.pins ?? { columns: [], crewDefault: false } },
    host: { announceChanges: announce, log: vi.fn() },
    git: options.git === false ? { locate: async () => null, commitTree: async () => undefined } : new TicketsGit(() => 'git'),
  };
  return { service: new PersonaRemoveService(deps), announce };
}

describe('PersonaRemoveService', () => {
  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'drey-persona-remove-'));
    git('init', '-q');
    git('config', 'user.name', 'Spec');
    git('config', 'user.email', 'spec@example.test');
    git('config', 'core.autocrlf', 'false');
    write(`${BEN}/persona.md`, persona('Ben'));
    write(`${BEN}/prompt.md`, 'Build things.\n');
    write(`${BEN}/memory.md`, '- a lesson\n');
    write(`${BEN}/reviews.md`, '# journal\n');
    write(`${BEN}/skills/review/SKILL.md`, '---\nname: review\ndescription: Reviews\n---\n');
    write(`${BEN}/skills/review/scripts/check.sh`, 'echo ok\n');
    write('tickets/_meta/personas/ralf/persona.md', persona('Ralf'));
    write('tickets/_meta/personas/you/persona.md', persona('You', 'human'));
    write('tickets/_meta/chat/ben-2026-11-09.md', 'the 1:1 with Ben\n');
    write('tickets/T-0001.md', 'a ticket\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'initial');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('deletes the folder whole in one commit and leaves the other personas, the chat files and the tickets', async () => {
    const { service, announce } = rig();
    const reply = await service.personaRemove({ persona: 'ben', confirm: 'Ben' });
    expect(reply).toEqual({ ok: true, persona: 'ben', files: 6 });
    expect(existsSync(path.join(dir, BEN))).toBe(false);
    expect(git('log', '--format=%s')).toBe('personas: ben removed\ninitial');
    const changed = git('show', '--name-status', '--format=', 'HEAD').split('\n').map((line) => line.replaceAll('\t', ' ')).sort();
    expect(changed).toEqual([
      `D ${BEN}/memory.md`,
      `D ${BEN}/persona.md`,
      `D ${BEN}/prompt.md`,
      `D ${BEN}/reviews.md`,
      `D ${BEN}/skills/review/SKILL.md`,
      `D ${BEN}/skills/review/scripts/check.sh`,
    ]);
    expect(git('status', '--porcelain')).toBe('');
    expect(existsSync(path.join(dir, 'tickets/_meta/personas/ralf/persona.md'))).toBe(true);
    expect(existsSync(path.join(dir, 'tickets/_meta/chat/ben-2026-11-09.md'))).toBe(true);
    expect(existsSync(path.join(dir, 'tickets/T-0001.md'))).toBe(true);
    expect(announce).toHaveBeenCalledWith('v', [], expect.arrayContaining([`${BEN}/persona.md`]));
  });

  it('deletes a persona of a vault outside git and says the change is not versioned', async () => {
    const { service } = rig({ git: false });
    const reply = await service.personaRemove({ persona: 'ben', confirm: 'Ben' });
    expect(reply).toMatchObject({ ok: true, persona: 'ben' });
    expect(reply.ok && reply.warning).toMatch(/not a git repository/);
    expect(existsSync(path.join(dir, BEN))).toBe(false);
  });

  it.each([['ben'], [' Ben'], ['Ben '], [''], ['BEN']])('refuses the typed name %j and deletes nothing', async (typed) => {
    const reply = await rig().service.personaRemove({ persona: 'ben', confirm: typed });
    expect(reply).toMatchObject({ ok: false, code: 'confirm' });
    expect(existsSync(path.join(dir, BEN, 'persona.md'))).toBe(true);
    expect(git('log', '--format=%s')).toBe('initial');
  });

  it('refuses the human persona even with its title typed', async () => {
    const reply = await rig().service.personaRemove({ persona: 'you', confirm: 'You' });
    expect(reply).toMatchObject({ ok: false, code: 'human' });
    expect(existsSync(path.join(dir, 'tickets/_meta/personas/you/persona.md'))).toBe(true);
  });

  it('req-269: refuses Mission Control\'s persona even with its title typed — Mission Control speaks with her prompt', async () => {
    write('tickets/_meta/personas/pia/persona.md', persona('Pia', 'mission'));
    write('tickets/_meta/personas/pia/prompt.md', '## Who Pia is\n');
    const reply = await rig().service.personaRemove({ persona: 'pia', confirm: 'Pia' });
    expect(reply).toMatchObject({ ok: false, code: 'mission' });
    expect(reply.ok === false && reply.error).toMatch(/Mission Control's persona/);
    expect(existsSync(path.join(dir, 'tickets/_meta/personas/pia/prompt.md'))).toBe(true);
    expect(git('log', '--format=%s')).toBe('initial');
  });

  it.each([['running'], ['starting'], ['stopping']])('refuses a persona with a %s run, 1:1 or session', async (state) => {
    const reply = await rig({ runs: [{ persona: 'ralf', state: 'running' }, { persona: 'ben', state }] }).service.personaRemove({ persona: 'ben', confirm: 'Ben' });
    expect(reply).toMatchObject({ ok: false, code: 'busy' });
    expect(existsSync(path.join(dir, BEN, 'persona.md'))).toBe(true);
  });

  it('does not count a finished run, another persona\'s run or an unreachable runner as busy', async () => {
    const finished = rig({ runs: [{ persona: 'ben', state: 'done' }, { persona: 'ben', state: 'failed' }, { persona: 'ralf', state: 'running' }] });
    expect((await finished.service.personaRemove({ persona: 'ben', confirm: 'Ben' })).ok).toBe(true);
    expect((await rig({ noRunner: true }).service.personaRemove({ persona: 'ralf', confirm: 'Ralf' })).ok).toBe(true);
  });

  it('refuses a pinned persona and names the columns and the crew default', async () => {
    const pins = { columns: ['Build', 'Review'], crewDefault: true };
    const reply = await rig({ pins }).service.personaRemove({ persona: 'ben', confirm: 'Ben' });
    expect(reply).toMatchObject({ ok: false, code: 'pinned', columns: ['Build', 'Review'], crewDefault: true });
    expect(reply.ok === false && reply.error).toContain('Build');
    expect(existsSync(path.join(dir, BEN, 'persona.md'))).toBe(true);
  });

  it('answers a code for an unknown persona, a bad id and a missing vault', async () => {
    expect(await rig().service.personaRemove({ persona: 'nobody', confirm: 'Nobody' })).toMatchObject({ ok: false, code: 'no_persona' });
    expect(await rig().service.personaRemove({ persona: '../x', confirm: 'x' })).toMatchObject({ ok: false, code: 'no_persona' });
    const none = new PersonaRemoveService({ ...({} as PersonaRemoveDeps), board: { detect: async () => null, loadPersona: async () => null } });
    expect(await none.personaRemove({ persona: 'ben', confirm: 'Ben' })).toMatchObject({ ok: false, code: 'no_vault' });
  });

  it('queues two removals of the same persona: the second finds it gone', async () => {
    const { service } = rig();
    const [first, second] = await Promise.all([service.personaRemove({ persona: 'ben', confirm: 'Ben' }), service.personaRemove({ persona: 'ben', confirm: 'Ben' })]);
    expect(first.ok).toBe(true);
    expect(second).toMatchObject({ ok: false, code: 'no_persona' });
    expect(git('log', '--format=%s')).toBe('personas: ben removed\ninitial');
  });
});
