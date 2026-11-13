import { describe, expect, it } from 'vitest';
import { checkDraft, mintProjectId } from './project-edit';

describe('project-edit (req-284)', () => {
  it('normalises a draft: trimmed name, lower-case colour, lists without blanks or duplicates', () => {
    const checked = checkDraft({ name: ' Drey ', color: '#8ECBEF', repos: ['drey', ' drey', ''], folders: ['E:\\specs', 'E:\\specs'], vaults: { ' Drey notes ': 'write' }, purpose: '  Hi.  ' });
    expect(checked).toEqual({ ok: true, draft: { name: 'Drey', color: '#8ecbef', repos: ['drey'], folders: ['E:\\specs'], vaults: { 'Drey notes': 'write' }, purpose: 'Hi.' } });
  });

  it('keeps an empty colour as none', () => {
    expect(checkDraft({ name: 'X', color: '', repos: [], folders: [], vaults: {}, purpose: '' })).toMatchObject({ ok: true, draft: { color: '' } });
  });

  it('mints ids: the name, then -2, -3; `project` for a name with no letters', () => {
    expect(mintProjectId('Home lab', [])).toBe('home-lab');
    expect(mintProjectId('Home lab', ['home-lab', 'home-lab-2'])).toBe('home-lab-3');
    expect(mintProjectId('!!!', [])).toBe('project');
  });
});
