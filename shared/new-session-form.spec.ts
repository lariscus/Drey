import { describe, expect, it } from 'vitest';
import { askOf, directoryOf, draftOf, type NewSessionOptions } from './new-session-form';

const options: NewSessionOptions = {
  ok: true,
  personas: [
    { id: 'ben', title: 'Ben', worker: 'claude-code' },
    { id: 'tessa', title: 'Tessa', worker: 'opencode' },
  ],
  classes: ['A', 'B', 'C'],
  ticketsVault: 'E:/tickets',
  repos: [{ name: 'drey', path: 'E:/drey' }],
  permissionMode: 'accept-edits',
  defaultPersona: null,
};

describe('the New session form model', () => {
  it('starts on the first persona, the tickets repository, Auto and the vault permission', () => {
    expect(draftOf(options)).toEqual({ persona: 'ben', folder: 'E:/tickets', typedFolder: '', poolClass: '', permission: 'accept-edits', firstLine: '' });
    expect(draftOf({ ...options, defaultPersona: 'tessa' }).persona).toBe('tessa');
  });

  it('asks with the listed folder, Auto as a null class, and no first line when blank', () => {
    expect(askOf(draftOf(options))).toEqual({ persona: 'ben', directory: 'E:/tickets', poolClass: null, permissionMode: 'accept-edits' });
  });

  it('lets a typed or browsed folder win over the list', () => {
    const draft = { ...draftOf(options), folder: 'E:/drey', typedFolder: '  E:/notes ' };
    expect(directoryOf(draft)).toBe('E:/notes');
    expect(directoryOf({ ...draft, typedFolder: ' ' })).toBe('E:/drey');
  });

  it('carries the class, the permission and a trimmed first line', () => {
    const draft = { ...draftOf(options), poolClass: 'B' as const, permission: 'read-only' as const, firstLine: ' read the notes \n' };
    expect(askOf(draft)).toEqual({ persona: 'ben', directory: 'E:/tickets', poolClass: 'B', permissionMode: 'read-only', firstLine: 'read the notes' });
  });

  it('makes no ask without a persona or a folder', () => {
    expect(askOf({ ...draftOf(options), persona: '' })).toBeNull();
    expect(askOf({ ...draftOf(options), folder: '' })).toBeNull();
    expect(askOf(draftOf({ ...options, personas: [] }))).toBeNull();
  });
});
