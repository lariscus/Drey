import { describe, expect, it } from 'vitest';
import { newTicketFileText } from '../ticket/ticket-files';
import { runTransition, type TransitionIo, type TransitionSpec } from './transition';

/** An in-memory host: ticket texts and the announcement count. */
function fakeIo(files: Map<string, string>, opts?: { readFails?: Set<string> }) {
  let announced = 0;
  const io: TransitionIo = {
    async read(path) {
      if (opts?.readFails?.has(path)) {
        throw new Error('ENOENT (fake)');
      }
      const text = files.get(path);
      if (text === undefined) {
        throw new Error(`missing ${path}`);
      }
      return text;
    },
    async write(path, text) {
      files.set(path, text);
    },
    announce() {
      announced += 1;
    },
  };
  return { io, files, announced: () => announced };
}

const NOW = new Date('2026-11-01T12:00:00Z');

function seedTicket(files: Map<string, string>, id = 'T-0001'): string {
  const path = `tickets/inbox/${id}.md`;
  files.set(
    path,
    newTicketFileText({
      id,
      title: 'Seed',
      repo: null,
      priority: 'normal',
      rank: 5000,
      firstPhase: 'inbox',
      now: NOW,
      actor: 'owner@desk',
      description: 'body',
    }),
  );
  return path;
}

function spec(overrides: Partial<TransitionSpec>): TransitionSpec {
  return {
    id: 'T-0001',
    fromPath: 'tickets/inbox/T-0001.md',
    patch: { to: 'build', from: 'inbox', now: NOW, actor: 'owner@desk' },
    ...overrides,
  };
}

describe('runTransition', () => {
  it('patches, writes at the target path and announces once', async () => {
    const files = new Map<string, string>();
    seedTicket(files);
    const host = fakeIo(files);

    const result = await runTransition(host.io, spec({ toPath: 'tickets/build/T-0001.md' }));

    expect(result).toEqual({ ok: true, path: 'tickets/build/T-0001.md' });
    const written = files.get('tickets/build/T-0001.md')!;
    expect(written).toContain('entered-build');
    expect(written).toContain('inbox -> build');
    expect(host.announced()).toBe(1);
  });

  it('patches in place without a target path', async () => {
    const files = new Map<string, string>();
    const path = seedTicket(files);
    const host = fakeIo(files);

    const result = await runTransition(host.io, spec({ text: files.get(path)!, toPath: undefined }));

    expect(result).toEqual({ ok: true, path });
    expect(host.announced()).toBe(1);
  });

  it('appends the extra Log line after the ordinary transition line (send back)', async () => {
    const files = new Map<string, string>();
    seedTicket(files);
    const host = fakeIo(files);

    await runTransition(host.io, spec({ extraLog: 'sent back: the gate log', toPath: 'tickets/build/T-0001.md' }));

    const written = files.get('tickets/build/T-0001.md')!;
    expect(written.indexOf('inbox -> build')).toBeLessThan(written.indexOf('sent back: the gate log'));
  });

  it('returns a patch failure without announcing', async () => {
    const files = new Map<string, string>();
    seedTicket(files);
    const host = fakeIo(files);
    host.io.read = async () => 'no frontmatter fence at all';

    const result = await runTransition(host.io, spec({}));

    expect(result).toEqual({ ok: false, error: 'ticket has no frontmatter fence' });
    expect(host.announced()).toBe(0);
  });

  it('reports a write failure as a failed move', async () => {
    const files = new Map<string, string>();
    seedTicket(files);
    const host = fakeIo(files);
    host.io.write = async () => {
      throw new Error('disk full');
    };

    const result = await runTransition(host.io, spec({ toPath: 'tickets/build/T-0001.md' }));

    expect(result).toEqual({ ok: false, error: 'move failed: disk full' });
    expect(host.announced()).toBe(0);
  });

  it('returns the spec readError instead of propagating a read failure', async () => {
    const files = new Map<string, string>();
    const host = fakeIo(files, { readFails: new Set(['tickets/inbox/T-0001.md']) });

    const result = await runTransition(host.io, spec({ readError: 'T-0001 is not in the archive' }));

    expect(result).toEqual({ ok: false, error: 'T-0001 is not in the archive' });
  });

  it('propagates a read failure when the spec names no readError', async () => {
    const files = new Map<string, string>();
    const host = fakeIo(files, { readFails: new Set(['tickets/inbox/T-0001.md']) });

    await expect(runTransition(host.io, spec({}))).rejects.toThrow('ENOENT (fake)');
  });
});
