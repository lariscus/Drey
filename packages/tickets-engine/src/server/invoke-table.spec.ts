import { describe, expect, it } from 'vitest';
import { InvokeTable } from './invoke-table';

describe('InvokeTable', () => {
  it('registers the named methods an object carries, bound to it, and skips the ones it lacks', async () => {
    const service = {
      prefix: 'a:',
      hello(name: unknown): string {
        return `${this.prefix}${String(name)}`;
      },
    };
    const table = new InvokeTable();
    table.register(service, ['hello', 'missing']);
    expect(table.has('hello')).toBe(true);
    expect(table.has('missing')).toBe(false);
    expect(await table.call('hello', 'x')).toBe('a:x');
  });

  it('a later registration of a name wins', async () => {
    const table = new InvokeTable();
    table.register({ ping: () => 'board' }, ['ping']);
    table.register({ ping: () => 'fleet' }, ['ping']);
    expect(await table.call('ping')).toBe('fleet');
    table.set('ping', async () => 'adapter');
    expect(await table.call('ping')).toBe('adapter');
  });

  it('an unknown method rejects with its name', async () => {
    await expect(new InvokeTable().call('nope')).rejects.toThrow('no such method: nope');
  });
});
