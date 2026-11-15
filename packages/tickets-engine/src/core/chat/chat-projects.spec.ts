import { describe, expect, it } from 'vitest';
import type { ChatCommand } from '../../contracts/chat';
import { projectsBlockOf, withCommandProject, withProjectsBlock } from './chat-projects';
import { validateChatCommand } from './chat-intents';

const TWO = [
  { id: 'drey', name: 'Drey' },
  { id: 'home-lab', name: 'Home lab' },
];
const CREATE: ChatCommand = { kind: 'createTicket', title: 'X', description: '', priority: 'normal', phase: 'inbox' };

describe('the projects block of a Mission Control turn (req-298)', () => {
  it('lists the projects by id and name, then the filter project', () => {
    expect(projectsBlockOf(TWO, 'home-lab')).toBe(
      '## Projects\n\ndrey "Drey" · home-lab "Home lab"\nThe owner\'s project filter is Home lab: a new ticket goes to "home-lab" unless the owner names another project.',
    );
  });

  it('tells Pia to ask under all projects, for an unknown filter id and for Unassigned', () => {
    for (const filter of [undefined, null, 'gone', '_unassigned']) {
      expect(projectsBlockOf(TWO, filter)).toContain('project filter is all projects: unless the owner named the project, ask which project');
    }
  });

  it('names the only project on a board with one; nothing on a board with none', () => {
    expect(projectsBlockOf([{ id: 'drey', name: 'Drey' }], undefined)).toContain('The board has one project: every new ticket goes to "drey".');
    expect(projectsBlockOf([], 'drey')).toBe('');
    expect(withProjectsBlock('digest', [], 'drey')).toBe('digest');
    expect(withProjectsBlock('digest', TWO, null)).toMatch(/^digest\n\n## Projects\n\n/);
  });
});

describe("a createTicket card's project (req-298)", () => {
  it('keeps a known project, else takes the filter, else the only project, else none', () => {
    expect(withCommandProject({ ...CREATE, project: 'drey' }, TWO, 'home-lab')).toMatchObject({ project: 'drey' });
    expect(withCommandProject(CREATE, TWO, 'home-lab')).toMatchObject({ project: 'home-lab' });
    expect(withCommandProject({ ...CREATE, project: 'gone' }, TWO, 'home-lab')).toMatchObject({ project: 'home-lab' });
    expect(withCommandProject(CREATE, [{ id: 'drey', name: 'Drey' }], undefined)).toMatchObject({ project: 'drey' });
    expect(withCommandProject({ ...CREATE, project: 'gone' }, TWO, null)).not.toHaveProperty('project');
    expect(withCommandProject(CREATE, [], 'drey')).not.toHaveProperty('project');
  });

  it('passes every other command unchanged', () => {
    const move: ChatCommand = { kind: 'transition', id: 'T-0001', from: 'inbox', to: 'done' };
    expect(withCommandProject(move, TWO, 'drey')).toBe(move);
  });

  it("the validator keeps a project id and drops junk without refusing the card", () => {
    expect(validateChatCommand({ ...CREATE, project: 'home-lab' })).toMatchObject({ project: 'home-lab' });
    expect(validateChatCommand({ ...CREATE, project: 'Home Lab!' })).not.toHaveProperty('project');
    expect(validateChatCommand({ ...CREATE, project: 7 })).toMatchObject({ kind: 'createTicket', title: 'X' });
  });
});
