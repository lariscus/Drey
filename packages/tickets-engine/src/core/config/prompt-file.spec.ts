import { promises as fsp } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { expandFragments, expandShippedFragments, loadPromptFragments, readPromptFile } from './prompt-file';

/** req-280: the one reader of the prompt files and the shared fragments a prompt pulls in by placeholder. */

let dir: string;

beforeEach(async () => {
  dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'drey-prompt-file-'));
});

afterEach(async () => {
  await fsp.rm(dir, { recursive: true, force: true });
});

describe('readPromptFile', () => {
  it('folds CRLF, drops the version marker and exactly one trailing newline', async () => {
    await fsp.writeFile(path.join(dir, 'a.md'), '<!-- drey-prompt-version: 3 -->\r\nLine one.\r\nLine two.\r\n\r\n', 'utf8');
    expect(await readPromptFile(dir, 'a.md', 'crew prompt')).toBe('Line one.\nLine two.\n');
  });

  it('names a missing file, and refuses one that holds only its marker', async () => {
    await expect(readPromptFile(dir, 'gone.md', 'fragment')).rejects.toThrow(/the fragment gone\.md is missing/);
    await fsp.writeFile(path.join(dir, 'b.md'), '<!-- drey-prompt-version: 1 -->\n\n', 'utf8');
    await expect(readPromptFile(dir, 'b.md', 'fragment')).rejects.toThrow(/the fragment b\.md .* is empty/);
  });
});

describe('the fragments', () => {
  it('replace every placeholder; a text without one, and null, stay as they are', () => {
    const fragments = { planFormat: 'PLAN', chainGrammar: 'CHAIN', flowProposal: 'PROPOSE' };
    expect(expandFragments('a {{plan-format}} b {{chain-grammar}} c {{plan-format}}', fragments)).toBe('a PLAN b CHAIN c PLAN');
    expect(expandFragments('plain', fragments)).toBe('plain');
    expect(expandFragments(null, fragments)).toBeNull();
  });

  it('expand the flow proposal only while the board proposes a flow (E10-5b)', () => {
    const fragments = { planFormat: 'PLAN', chainGrammar: 'CHAIN', flowProposal: 'PROPOSE' };
    expect(expandFragments('{{plan-format}}', fragments)).toBe('PLAN');
    expect(expandFragments('{{plan-format}}', fragments, { proposeFlow: false })).toBe('PLAN');
    expect(expandFragments('a {{plan-format}} b', fragments, { proposeFlow: true })).toBe('a PLAN\n\nPROPOSE b');
    expect(expandFragments('x {{flow-proposal}}', fragments, { proposeFlow: true })).toBe('x PROPOSE');
    expect(expandFragments('x {{flow-proposal}}', fragments)).toBe('x ');
  });

  it('load from <dir>/fragments/ without their markers', async () => {
    await fsp.mkdir(path.join(dir, 'fragments'));
    await fsp.writeFile(path.join(dir, 'fragments', 'plan-format.md'), '<!-- drey-prompt-version: 1 -->\nPLAN\n', 'utf8');
    await fsp.writeFile(path.join(dir, 'fragments', 'chain-grammar.md'), 'CHAIN\n', 'utf8');
    await fsp.writeFile(path.join(dir, 'fragments', 'flow-proposal.md'), '<!-- drey-prompt-version: 1 -->\nPROPOSE\n', 'utf8');
    expect(await loadPromptFragments(dir)).toEqual({ planFormat: 'PLAN', chainGrammar: 'CHAIN', flowProposal: 'PROPOSE' });
    expect(await expandShippedFragments('x {{chain-grammar}}', dir)).toBe('x CHAIN');
  });

  it('a persona prompt without a placeholder reads no fragment file', async () => {
    expect(await expandShippedFragments('no placeholder here', path.join(dir, 'nowhere'))).toBe('no placeholder here');
  });
});
